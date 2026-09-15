// Zod 4 promotes common string formats to top-level functions — z.email()
// instead of z.string().email(), z.uuid() instead of z.string().uuid(), and
// so on. If you're reading tutorials that still show the chained form,
// they're written against Zod 3; both compile, but z.string().email() is
// deprecated in v4's own type definitions.
import { z } from 'zod';

export const registerCustomerSchema = z.object({
  fullName: z.string().trim().min(2, { error: 'Full name is too short.' }).max(100),
  email: z.email({ error: 'Enter a valid email address.' }),
  password: z.string().min(8, { error: 'Password must be at least 8 characters.' }),
  phone: z.string().trim().min(7).max(20).optional(),
  primaryDeliveryAddress: z.string().trim().min(5).max(300).optional(),
});
export type RegisterCustomerInput = z.infer<typeof registerCustomerSchema>;

// Mirrors every field VendorRegister.jsx collects (fullName, homeAddress,
// shopName, shopAddress, businessType, phone, email, username, password) —
// the ID card file itself arrives separately via multer, not through this
// JSON-shaped schema.
export const registerVendorSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  homeAddress: z.string().trim().min(5, { error: 'Enter a full residential address.' }).max(300),
  shopName: z.string().trim().min(2).max(150),
  shopAddress: z.string().trim().min(5, { error: 'Enter a full shop address.' }).max(300),
  businessType: z.string().trim().min(2).max(100).default('retail'),
  phone: z.string().trim().min(7).max(20),
  email: z.email().optional(),
  username: z.string().trim().min(3).max(40),
  password: z.string().min(8, { error: 'Password must be at least 8 characters.' }),
});
export type RegisterVendorInput = z.infer<typeof registerVendorSchema>;

// Mirrors registerVendorSchema's shape (and DispatcherPortal.jsx's
// registration form): a dispatcher also goes through admin verification
// before they can log in, with vehicle details standing in for
// shop details.
export const registerDispatcherSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  currentResidentialAddress: z.string().trim().min(5, { error: 'Enter your current address.' }).max(300),
  permanentHomeAddress: z.string().trim().min(5, { error: 'Enter your permanent home address.' }).max(300),
  phone: z.string().trim().min(7).max(20),
  vehicleType: z.enum(['MOTORCYCLE', 'TRICYCLE', 'CAR', 'VAN', 'TRUCK'], { error: 'Select a valid vehicle type.' }),
  vehicleRegNumber: z.string().trim().min(3).max(30),
  username: z.string().trim().min(3).max(40),
  password: z.string().min(8, { error: 'Password must be at least 8 characters.' }),
});
export type RegisterDispatcherInput = z.infer<typeof registerDispatcherSchema>;

// The frontend's login form accepts "email or phone" (and vendor login
// accepts "username or phone") — one flexible `identifier` field on the
// backend covers all three without three separate endpoints.
export const loginSchema = z.object({
  identifier: z.string().trim().min(3, { error: 'Enter your email, phone, or username.' }),
  password: z.string().min(1, { error: 'Password is required.' }),
});
export type LoginInput = z.infer<typeof loginSchema>;
