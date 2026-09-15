import { prisma } from '../config/prisma.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { AppError } from '../utils/AppError.js';
import { issueTokenPair } from './token.service.js';
import type { RegisterCustomerInput, RegisterVendorInput, RegisterDispatcherInput, LoginInput } from '../schemas/auth.schema.js';
import type { User, VendorProfile, DispatchRiderProfile } from '../generated/prisma/client.js';

interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}

type SafeUser = Omit<User, 'passwordHash'>;

/** Never let a passwordHash — even a correctly-hashed one — leave this module in an API response. */
function toSafeUser(user: User): SafeUser {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

export async function registerCustomer(
  input: RegisterCustomerInput,
  meta: RequestMeta,
): Promise<{ user: SafeUser; tokens: { accessToken: string; refreshToken: string } }> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError('An account with this email already exists.', 409);
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      fullName: input.fullName,
      email: input.email,
      passwordHash,
      phone: input.phone,
      primaryDeliveryAddress: input.primaryDeliveryAddress,
      role: 'CUSTOMER',
    },
  });

  const tokens = await issueTokenPair({
    userId: user.id,
    role: user.role,
    userAgent: meta.userAgent,
    ipAddress: meta.ipAddress,
  });

  return { user: toSafeUser(user), tokens };
}

export async function registerVendor(
  input: RegisterVendorInput,
  idCardUrl: string | undefined,
): Promise<{ user: SafeUser; vendorProfile: VendorProfile | null }> {
  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ username: input.username }, ...(input.email ? [{ email: input.email }] : [])],
    },
  });
  if (existing) {
    throw new AppError('An account with this username or email already exists.', 409);
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      fullName: input.fullName,
      email: input.email,
      username: input.username,
      phone: input.phone,
      passwordHash,
      role: 'VENDOR',
      vendorProfile: {
        create: {
          shopName: input.shopName,
          shopAddress: input.shopAddress,
          homeAddress: input.homeAddress,
          businessType: input.businessType,
          idCardUrl,
          status: 'PENDING',
        },
      },
    },
    include: { vendorProfile: true },
  });

  // Deliberately no tokens issued here: BravoMart requires KYC review
  // before a shop can log in (see login() below), matching the
  // "pending_verification" state VendorLogin.jsx already expects.
  return { user: toSafeUser(user), vendorProfile: user.vendorProfile };
}

export async function registerDispatcher(
  input: RegisterDispatcherInput,
  idCardUrl: string | undefined,
): Promise<{ user: SafeUser; dispatchRiderProfile: DispatchRiderProfile | null }> {
  const existing = await prisma.user.findFirst({ where: { username: input.username } });
  if (existing) {
    throw new AppError('An account with this username already exists.', 409);
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      fullName: input.fullName,
      username: input.username,
      phone: input.phone,
      passwordHash,
      role: 'DISPATCHER',
      dispatchRiderProfile: {
        create: {
          vehicleType: input.vehicleType,
          vehicleRegNumber: input.vehicleRegNumber,
          currentResidentialAddress: input.currentResidentialAddress,
          permanentHomeAddress: input.permanentHomeAddress,
          idCardUrl,
          status: 'PENDING',
        },
      },
    },
    include: { dispatchRiderProfile: true },
  });

  // Same reasoning as registerVendor(): no tokens until BravoMart admin
  // approves the application (see login() below).
  return { user: toSafeUser(user), dispatchRiderProfile: user.dispatchRiderProfile };
}

export async function login(
  input: LoginInput,
  meta: RequestMeta,
): Promise<{ user: SafeUser; tokens: { accessToken: string; refreshToken: string } }> {
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: input.identifier }, { username: input.identifier }, { phone: input.identifier }],
    },
    include: { vendorProfile: true, dispatchRiderProfile: true },
  });

  // Same generic message whether the identifier doesn't exist or the
  // password is wrong — telling an attacker "that email isn't registered"
  // vs. "wrong password" leaks which emails have accounts at all.
  if (!user) {
    throw new AppError('Invalid credentials.', 401);
  }

  const passwordMatches = await verifyPassword(input.password, user.passwordHash);
  if (!passwordMatches) {
    throw new AppError('Invalid credentials.', 401);
  }

  if (user.role === 'VENDOR' && user.vendorProfile?.status !== 'APPROVED') {
    throw new AppError('Invalid credentials or shop verification is still pending by BravoMart Admin.', 403);
  }

  if (user.role === 'DISPATCHER' && user.dispatchRiderProfile?.status !== 'APPROVED') {
    throw new AppError('Invalid credentials or dispatcher verification is still pending by BravoMart Admin.', 403);
  }

  const tokens = await issueTokenPair({
    userId: user.id,
    role: user.role,
    vendorProfileId: user.vendorProfile?.id,
    dispatchRiderProfileId: user.dispatchRiderProfile?.id,
    userAgent: meta.userAgent,
    ipAddress: meta.ipAddress,
  });

  return { user: toSafeUser(user), tokens };
}

export async function getCurrentUser(userId: string): Promise<SafeUser & { vendorProfile: VendorProfile | null }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { vendorProfile: true },
  });

  if (!user) {
    throw new AppError('User not found.', 404);
  }

  const { vendorProfile, ...rest } = user;
  return { ...toSafeUser(rest as User), vendorProfile };
}
