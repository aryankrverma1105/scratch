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

// Middleware that compresses and resizes selfie to ~30KB-70KB before saving
async function compressSelfie(req, res, next) {
  if (!req.file || !req.file.buffer) {
    return next();
  }

  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
  const filename = `selfie-${uniqueSuffix}.jpg`;
  const outputPath = path.join(config.SELFIE_DIR, filename);

  const originalSizeBytes = req.file.buffer.length;

  try {
    // Resize to max 640x640, rotate correctly from EXIF, compress to JPEG quality 72 with mozjpeg
    await sharp(req.file.buffer)
      .rotate() // Auto-orient based on camera EXIF
      .resize(640, 640, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({
        quality: 72,
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
    console.error('Sharp compression warning, falling back to raw save:', err.message);
    try {
      fs.writeFileSync(outputPath, req.file.buffer);
      req.file.filename = filename;
      req.file.path = outputPath;
      next();
    } catch (writeErr) {
      next(writeErr);
    }
  }
}

module.exports = {
  upload,
  compressSelfie,
};
