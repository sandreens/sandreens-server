const Settings = require('../models/Settings');
const Product = require('../models/Product');
const { deleteFromCloudinary } = require('../utils/cloudinaryHelper');

// Sob shomoy ekta document e kaj kortesi. Na thakle banai (upsert-er moto).
const getSettingsDoc = async () => {
  let settings = await Settings.findOne();
  if (!settings) {
    settings = await Settings.create({});
  }
  return settings;
};

// @desc    Get site settings
// @route   GET /api/settings
// @access  Public (user panel eo lagbe: footer, contact info ityadi)
const getSettings = async (req, res) => {
  try {
    const settings = await getSettingsDoc();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update site settings
// @route   PUT /api/settings
// @access  Private/Admin
const updateSettings = async (req, res) => {
  try {
    const settings = await getSettingsDoc();

    // If size guide image is changed/updated, delete the old one from Cloudinary
    if (req.body.sizeGuideImage !== undefined && settings.sizeGuideImage && settings.sizeGuideImage !== req.body.sizeGuideImage) {
      deleteFromCloudinary(settings.sizeGuideImage).catch(err =>
        console.error('Failed to delete old size guide image from Cloudinary:', err)
      );
    }

    // Find removed sizes to pull from existing products
    const oldNumberSizes = settings.numberSizes || [];
    const oldLetterSizes = settings.letterSizes || [];

    const newNumberSizes = req.body.numberSizes !== undefined ? req.body.numberSizes : oldNumberSizes;
    const newLetterSizes = req.body.letterSizes !== undefined ? req.body.letterSizes : oldLetterSizes;

    const removedSizes = [
      ...oldNumberSizes.filter(s => !newNumberSizes.includes(s)),
      ...oldLetterSizes.filter(s => !newLetterSizes.includes(s))
    ];

    const fields = [
      'logo', 'favicon', 'contactEmail', 'contactPhone', 'contactAddress',
      'termsConditions', 'privacyPolicy', 'footerText',
      'numberSizes', 'letterSizes', 'sizeGuideText', 'sizeGuideImage',
    ];
    fields.forEach((f) => {
      if (req.body[f] !== undefined) settings[f] = req.body[f];
    });

    if (req.body.socialLinks) {
      settings.socialLinks = {
        ...settings.socialLinks.toObject(),
        ...req.body.socialLinks,
      };
    }

    await settings.save();

    // If any size was removed, pull it from all products in the database
    if (removedSizes.length > 0) {
      await Product.updateMany(
        { sizes: { $in: removedSizes } },
        { $pull: { sizes: { $in: removedSizes } } }
      );
    }

    res.json(settings);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = { getSettings, updateSettings };