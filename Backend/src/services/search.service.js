import { Product }  from '../models/Product.js';
import { Category } from '../models/Category.js';
import { getCache, setCache } from '../config/redis.js';

export class SearchService {

  // Full search with aggregation pipeline
  static async search({ q, filters = {}, sort = 'relevance', page = 1, limit = 20 }) {
    const skip   = (page - 1) * limit;
    const cacheKey = `search:${JSON.stringify({ q, filters, sort, page, limit })}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const match = { status: 'active' };

    if (q)                match.$text     = { $search: q };
    if (filters.category) match.category  = filters.category;
    if (filters.brand)    match.brand     = { $regex: new RegExp(`^${filters.brand}$`, 'i') };
    if (filters.minPrice || filters.maxPrice) {
      match.basePrice = {};
      if (filters.minPrice) match.basePrice.$gte = Number(filters.minPrice);
      if (filters.maxPrice) match.basePrice.$lte = Number(filters.maxPrice);
    }
    if (filters.rating)   match['rating.average'] = { $gte: Number(filters.rating) };
    if (filters.inStock)  match.totalStock         = { $gt: 0 };

    const sortMap = {
      relevance:  q ? { score: { $meta: 'textScore' } } : { purchaseCount: -1 },
      price_asc:  { basePrice: 1 },
      price_desc: { basePrice: -1 },
      rating:     { 'rating.average': -1 },
      newest:     { createdAt: -1 },
      popular:    { purchaseCount: -1 },
    };

    const projection = q ? { score: { $meta: 'textScore' } } : {};

    const [products, total, brands] = await Promise.all([
      Product.find(match, projection)
        .sort(sortMap[sort])
        .skip(skip)
        .limit(limit)
        .populate('category', 'name slug')
        .select('name slug images basePrice baseMrp rating totalStock brand category')
        .lean(),
      Product.countDocuments(match),
      // Get available brands for filter panel
      Product.distinct('brand', { ...match, brand: { $ne: '' } }),
    ]);

    const result = { products, total, brands: brands.slice(0, 20) };
    await setCache(cacheKey, result, 120); // 2 min

    return result;
  }

  // Get trending searches from Redis
  static async getTrending(limit = 10) {
    const cached = await getCache('search:trending');
    if (cached) return cached;

    // Fallback: return top purchased product names
    const products = await Product.find({ status: 'active' })
      .sort({ purchaseCount: -1 })
      .limit(limit)
      .select('name')
      .lean();

    const trending = products.map((p) => p.name);
    await setCache('search:trending', trending, 3600);
    return trending;
  }

  // Record search term (increment in Redis sorted set)
  static async recordSearch(term) {
    if (!term || term.length < 2) return;
    const { getRedis } = await import('../config/redis.js');
    const redis = getRedis();
    await redis.zIncrBy('search:popular', 1, term.toLowerCase().trim());
  }
}