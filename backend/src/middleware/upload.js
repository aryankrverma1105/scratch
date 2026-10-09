const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const config = require('../config');

// Ensure destination exists
if (!fs.existsSync(config.SELFIE_DIR)) {
  fs.mkdirSync(config.SELFIE_DIR, { recursive: true });
}

// In-memory buffer storage so sharp can process before saving to disk
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed for selfie'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 15 * 1024 * 1024, // Accept up to 15MB upload before compression
  },
});

// Middleware that compresses and resizes selfie to ~40KB-80KB before saving
async function compressSelfie(req, res, next) {
  if (!req.file || !req.file.buffer) {
    return next();
  }

  const originalSizeBytes = req.file.buffer.length;

  try {
    // 1. Inspect image metadata with sharp - reject non-images or corrupt files
    const image = sharp(req.file.buffer);
    const metadata = await image.metadata();

    const allowedFormats = ['jpeg', 'jpg', 'png', 'webp', 'heif', 'tiff'];
    if (!metadata.format || !allowedFormats.includes(metadata.format.toLowerCase())) {
      return res.status(400).json({
        error: 'Invalid image format. Genuine camera selfie (JPEG, PNG, WebP) is required.',
      });
    }

    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const filename = `selfie-${uniqueSuffix}.jpg`;
    const outputPath = path.join(config.SELFIE_DIR, filename);

    // 2. Auto-rotate from EXIF, resize to max 800x800, compress JPEG quality 78, strip EXIF/GPS
    await image
      .rotate() // Auto-orient based on camera EXIF
      .resize(800, 800, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({
        quality: 78,
        progressive: true,
        mozjpeg: true,
      })
      .toFile(outputPath);

    const stats = fs.statSync(outputPath);
    const compressedSizeBytes = stats.size;
    const savingsPercent = (((originalSizeBytes - compressedSizeBytes) / originalSizeBytes) * 100).toFixed(1);

    console.log(
      `📸 Selfie Compressed: ${(originalSizeBytes / 1024).toFixed(1)} KB -> ${(compressedSizeBytes / 1024).toFixed(1)} KB (${savingsPercent}% saved on GCP disk)`
    );

    // Populate file metadata for downstream controller
    req.file.filename = filename;
    req.file.path = outputPath;
    req.file.size = compressedSizeBytes;
    req.file.mimetype = 'image/jpeg';
    next();
  } catch (err) {
    console.error('Sharp validation/compression failed:', err.message);
    // Requirement: Validate with sharp metadata; reject non-images (400). Remove fallback to raw save.
    return res.status(400).json({
      error: 'Unreadable or invalid image file. Please take a clear camera photo.',
      details: err.message,
    });
  }
}

module.exports = {
  upload,
  compressSelfie,
};
