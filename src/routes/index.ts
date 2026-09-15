import { Router } from 'express';
import authRoutes from './auth.routes.js';
import productRoutes from './product.routes.js';
import categoryRoutes from './category.routes.js';
import adminRoutes from './admin.routes.js';
import vendorRoutes from './vendor.routes.js';
import cartRoutes from './cart.routes.js';
import orderRoutes from './order.routes.js';
import dispatchRoutes from './dispatch.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/products', productRoutes);
router.use('/categories', categoryRoutes);
router.use('/admin', adminRoutes);
router.use('/vendor', vendorRoutes);
router.use('/cart', cartRoutes);
router.use('/orders', orderRoutes);
router.use('/dispatch', dispatchRoutes);

export default router;
