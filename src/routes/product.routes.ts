import { Router } from 'express';
import * as productController from '../controllers/product.controller.js';
import { validate } from '../middlewares/validate.js';
import { productListQuerySchema, productIdParamsSchema } from '../schemas/product.schema.js';

const router = Router();

// Public — this powers Marketplace.jsx's product grid, no login required.
router.get('/', validate({ query: productListQuerySchema }), productController.getProducts);
router.get('/:id', validate({ params: productIdParamsSchema }), productController.getProductById);

export default router;
