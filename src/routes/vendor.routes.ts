import { Router } from 'express';
import * as vendorController from '../controllers/vendor.controller.js';
import { authenticate } from '../middlewares/authenticate.js';
import { authorize } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import { updateVendorLocationSchema, vendorWalletQuerySchema } from '../schemas/vendor.schema.js';

const router = Router();

router.use(authenticate, authorize('VENDOR'));

router.patch('/me/location', validate({ body: updateVendorLocationSchema }), vendorController.updateOwnShopLocation);
router.get('/me/wallet', validate({ query: vendorWalletQuerySchema }), vendorController.getOwnWalletHistory);

export default router;
