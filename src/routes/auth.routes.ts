import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { authenticate } from '../middlewares/authenticate.js';
import { upload } from '../middlewares/upload.js';
import { validate } from '../middlewares/validate.js';
import { authRateLimiter } from '../middlewares/rateLimiter.js';
import { registerCustomerSchema, registerVendorSchema, registerDispatcherSchema, loginSchema } from '../schemas/auth.schema.js';

const router = Router();

router.post('/register', validate({ body: registerCustomerSchema }), authController.registerCustomer);

// `upload.single('idCard')` runs BEFORE `validate` on purpose: multer is
// what parses a multipart/form-data body in the first place, populating
// req.body with the text fields alongside req.file for the ID document —
// validate() has nothing to check until multer has run.
router.post(
  '/vendor/register',
  upload.single('idCard'),
  validate({ body: registerVendorSchema }),
  authController.registerVendor,
);

router.post(
  '/dispatcher/register',
  upload.single('idCard'),
  validate({ body: registerDispatcherSchema }),
  authController.registerDispatcher,
);

router.post('/login', authRateLimiter, validate({ body: loginSchema }), authController.login);

// No `authenticate` here — the refresh token itself (read from the httpOnly
// cookie inside the controller) is the credential for this route.
router.post('/refresh', authController.refresh);

// No `authenticate` here either: by the time someone wants to log out,
// their access token may already be expired, and logout should still work
// off the refresh cookie alone.
router.post('/logout', authController.logout);

router.get('/me', authenticate, authController.me);

export default router;
