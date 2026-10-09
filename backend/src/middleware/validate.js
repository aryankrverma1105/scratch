const { z } = require('zod');

function validateBody(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      return res.status(400).json({ error: 'Invalid input data' });
    }
  };
}

const loginSchema = z.object({
  identifier: z.string().trim().min(2, 'Username or email required'),
  password: z.string().min(1, 'Password required'),
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, 'Old password required'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters'),
});

const createUserSchema = z.object({
  email: z.string().email('Valid email required'),
  username: z.union([z.string().min(2).max(50), z.literal(''), z.null()]).optional(),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  full_name: z.string().min(2, 'Full name required'),
  role: z.enum(['admin', 'employee']).default('employee'),
  department: z.union([z.string(), z.null()]).optional(),
  phone: z.union([z.string(), z.null()]).optional(),
});

const locationTrackSchema = z.object({
  latitude: z.union([z.number(), z.string().transform(Number)]).refine((v) => !isNaN(v) && v >= -90 && v <= 90, {
    message: 'Latitude must be between -90 and 90',
  }),
  longitude: z.union([z.number(), z.string().transform(Number)]).refine((v) => !isNaN(v) && v >= -180 && v <= 180, {
    message: 'Longitude must be between -180 and 180',
  }),
  accuracy: z.union([z.number(), z.null()]).optional(),
  speed: z.union([z.number(), z.null()]).optional(),
  altitude: z.union([z.number(), z.null()]).optional(),
  battery_level: z.union([z.number(), z.null()]).optional(),
  is_mocked: z.boolean().optional(),
  timestamp: z.string().optional(),
});

module.exports = {
  validateBody,
  loginSchema,
  changePasswordSchema,
  createUserSchema,
  locationTrackSchema,
};
