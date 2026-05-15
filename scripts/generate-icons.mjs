/**
 * PWABuilder Icon Generator
 * Generates all required icon sizes from icon-512.png for PWABuilder compliance.
 * Run: node scripts/generate-icons.mjs
 */
import sharp from 'sharp';
import { mkdir, copyFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ICONS_DIR = join(ROOT, 'public', 'icons');
const SOURCE_ANY = join(ICONS_DIR, 'icon-512.png');

// All sizes required by PWABuilder for Microsoft Store, Android, iOS
const SIZES = [
  16,   // favicon
  20,   // Windows small tile
  24,   // Windows badge
  30,   // Windows small tile @1.5x
  32,   // favicon @2x
  36,   // Android
  44,   // Windows badge @2x (REQUIRED by Microsoft Store)
  48,   // Android
  50,   // Windows tile list
  60,   // Windows target size
  64,   // Windows tile
  71,   // Windows small tile (REQUIRED by Microsoft Store)
  72,   // Android
  80,   // Windows target size
  89,   // Windows target size
  96,   // Android
  107,  // Windows small tile @1.5x
  120,  // iOS (iPhone)
  128,  // Chrome Web Store
  142,  // Windows medium tile
  144,  // Android / Windows tile
  150,  // Windows medium tile (REQUIRED by Microsoft Store)
  152,  // iOS iPad
  167,  // iOS iPad Pro
  180,  // iOS (apple-touch-icon, REQUIRED)
  192,  // Android (REQUIRED for installability)
  256,  // Windows medium/large
  284,  // Windows medium tile @2x
  310,  // Windows wide/large tile (REQUIRED by Microsoft Store)
  512,  // PWA splash screen (REQUIRED)
];

async function generateIcons() {
  await mkdir(ICONS_DIR, { recursive: true });

  console.log('🎨 Generating PWABuilder-compliant icons...\n');

  for (const size of SIZES) {
    const filename = `icon-${size}.png`;
    const outputPath = join(ICONS_DIR, filename);

    try {
      await sharp(SOURCE_ANY)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 10, g: 10, b: 15, alpha: 1 },
        })
        .png({ quality: 95, compressionLevel: 9 })
        .toFile(outputPath);

      console.log(`  ✅ ${filename} (${size}x${size})`);
    } catch (err) {
      console.error(`  ❌ ${filename}: ${err.message}`);
    }
  }

  // Generate maskable version at 512 (with padding for safe zone)
  try {
    const maskablePath = join(ICONS_DIR, 'icon-maskable-512.png');
    // Maskable icon: content should be within 80% safe zone
    // So we resize the logo to 80% and put it on a padded background
    const padding = Math.round(512 * 0.1); // 10% each side = 80% safe area
    const innerSize = 512 - (padding * 2);

    const logoBuffer = await sharp(SOURCE_ANY)
      .resize(innerSize, innerSize, { fit: 'contain', background: { r: 10, g: 10, b: 15, alpha: 1 } })
      .toBuffer();

    await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 4,
        background: { r: 10, g: 10, b: 15, alpha: 1 },
      },
    })
      .composite([{ input: logoBuffer, left: padding, top: padding }])
      .png({ quality: 95 })
      .toFile(maskablePath);

    console.log(`  ✅ icon-maskable-512.png (512x512, maskable safe-zone)`);
  } catch (err) {
    console.error(`  ❌ icon-maskable-512.png: ${err.message}`);
  }

  // Generate maskable at 192
  try {
    const maskablePath192 = join(ICONS_DIR, 'icon-maskable-192.png');
    const padding192 = Math.round(192 * 0.1);
    const innerSize192 = 192 - (padding192 * 2);

    const logoBuffer192 = await sharp(SOURCE_ANY)
      .resize(innerSize192, innerSize192, { fit: 'contain', background: { r: 10, g: 10, b: 15, alpha: 1 } })
      .toBuffer();

    await sharp({
      create: {
        width: 192,
        height: 192,
        channels: 4,
        background: { r: 10, g: 10, b: 15, alpha: 1 },
      },
    })
      .composite([{ input: logoBuffer192, left: padding192, top: padding192 }])
      .png({ quality: 95 })
      .toFile(maskablePath192);

    console.log(`  ✅ icon-maskable-192.png (192x192, maskable safe-zone)`);
  } catch (err) {
    console.error(`  ❌ icon-maskable-192.png: ${err.message}`);
  }

  // Generate 1024 for App Store
  try {
    await sharp(SOURCE_ANY)
      .resize(1024, 1024, {
        fit: 'contain',
        background: { r: 10, g: 10, b: 15, alpha: 1 },
      })
      .png({ quality: 95 })
      .toFile(join(ICONS_DIR, 'icon-1024.png'));

    console.log(`  ✅ icon-1024.png (1024x1024, store listing)`);
  } catch (err) {
    console.error(`  ❌ icon-1024.png: ${err.message}`);
  }

  // Generate favicon.ico (32x32)
  try {
    await sharp(SOURCE_ANY)
      .resize(32, 32)
      .toFormat('png')
      .toFile(join(ROOT, 'public', 'favicon.png'));

    console.log(`  ✅ favicon.png (32x32)`);
  } catch (err) {
    console.error(`  ❌ favicon.png: ${err.message}`);
  }

  console.log('\n🎉 Icon generation complete!');
  console.log(`   Total: ${SIZES.length + 4} icons generated in public/icons/`);
}

generateIcons().catch(console.error);
