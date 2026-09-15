// Run with: npx prisma db seed
// (Prisma 7 only seeds when you explicitly ask — it no longer auto-runs
// this during `prisma migrate dev` / `prisma migrate reset`.)
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma/client.js';

const adapter = new PrismaPg(process.env.DATABASE_URL as string);
const prisma = new PrismaClient({ adapter });

// This list must stay in lockstep with PRODUCT_CATEGORIES in
// src/schemas/aiProduct.schema.ts — that's the enum we force Gemini's
// structured output to pick from, and every value it can return needs a
// matching Category row for the foreign key to resolve.
const CATEGORY_SEED = ['Clothing', 'Electronics', 'Home', 'Beauty', 'Other'] as const;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function seedCategories(): Promise<void> {
  console.log('Seeding categories...');
  for (const name of CATEGORY_SEED) {
    await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name, slug: slugify(name) },
    });
  }
}

async function seedSuperAdmin(): Promise<void> {
  console.log('Seeding super admin...');
  const passwordHash = await bcrypt.hash('ChangeMe123!', 12);
  await prisma.user.upsert({
    where: { email: 'superadmin@bravomart.ng' },
    update: {},
    create: {
      fullName: 'BravoMart Root Admin',
      email: 'superadmin@bravomart.ng',
      passwordHash,
      role: 'SUPER_ADMIN',
    },
  });
}

async function seedDemoVendor(): Promise<void> {
  console.log('Seeding demo (pre-approved) vendor...');
  const passwordHash = await bcrypt.hash('VendorPass123!', 12);

  const vendorUser = await prisma.user.upsert({
    where: { email: 'demo.vendor@bravomart.ng' },
    update: {},
    create: {
      fullName: 'Demo Merchant',
      email: 'demo.vendor@bravomart.ng',
      username: 'demo-vendor',
      passwordHash,
      role: 'VENDOR',
    },
  });

  await prisma.vendorProfile.upsert({
    where: { userId: vendorUser.id },
    update: {},
    create: {
      userId: vendorUser.id,
      shopName: 'Bravo Mega Store',
      shopAddress: '12 Marina Street, Lagos Island',
      businessType: 'general',
      status: 'APPROVED',
      shopLat: 6.4531,
      shopLng: 3.3958,
    },
  });
}

async function seedDemoDispatcher(): Promise<void> {
  console.log('Seeding demo (pre-approved) dispatcher...');
  const passwordHash = await bcrypt.hash('RiderPass123!', 12);

  const riderUser = await prisma.user.upsert({
    where: { username: 'demo-rider' },
    update: {},
    create: {
      fullName: 'Demo Dispatch Rider',
      username: 'demo-rider',
      phone: '+2348030000000',
      passwordHash,
      role: 'DISPATCHER',
    },
  });

  await prisma.dispatchRiderProfile.upsert({
    where: { userId: riderUser.id },
    update: {},
    create: {
      userId: riderUser.id,
      vehicleType: 'MOTORCYCLE',
      vehicleRegNumber: 'LAG-882-AB',
      currentResidentialAddress: '12 Admiralty Way, Lekki Phase 1, Lagos',
      permanentHomeAddress: 'Compound 4, Umudike, Abia State',
      status: 'APPROVED',
      isAvailable: true,
      currentLat: 6.4531,
      currentLng: 3.3958,
    },
  });
}

async function main(): Promise<void> {
  await seedCategories();
  await seedSuperAdmin();
  await seedDemoVendor();
  await seedDemoDispatcher();
  console.log('Seed complete.');
  console.log('  Super admin login: superadmin@bravomart.ng / ChangeMe123!');
  console.log('  Demo vendor login: demo-vendor / VendorPass123!');
  console.log('  Demo dispatcher login: demo-rider / RiderPass123!');
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
