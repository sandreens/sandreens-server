const cloudinary = require('../config/cloudinary');

/**
 * Safely extracts the public_id of an image from its Cloudinary URL.
 * Supports URLs with version prefixes (e.g., v123456) and directory paths.
 * Returns null if the URL is invalid or not from Cloudinary.
 * 
 * Example input:  https://res.cloudinary.com/cloud_name/image/upload/v1234567/folder/image.png
 * Example output: folder/image
 * 
 * @param {string} url - The complete Cloudinary image URL
 * @returns {string|null} - The public_id or null
 */
const extractPublicId = (url) => {
    if (!url || typeof url !== 'string') return null;
    
    // Ensure the URL is from Cloudinary
    if (!url.includes('cloudinary.com')) return null;

    try {
        // Split by '/upload/' to extract everything after it
        const parts = url.split('/upload/');
        if (parts.length < 2) return null;

        let pathPart = parts[1];

        // Remove the version number prefix (e.g. 'v123456789/') if it exists
        pathPart = pathPart.replace(/^v\d+\//, '');

        // Remove the file extension (e.g. '.jpg', '.png') from the end
        const dotIndex = pathPart.lastIndexOf('.');
        if (dotIndex !== -1) {
            pathPart = pathPart.substring(0, dotIndex);
        }

        return pathPart;
    } catch (error) {
        console.error('Error extracting Cloudinary public ID:', error);
        return null;
    }
};

/**
 * Deletes a single image from Cloudinary using its URL.
 * 
 * @param {string} url - The Cloudinary image URL
 * @returns {Promise<boolean>} - True if deletion was successful (or skipped), false otherwise
 */
const deleteFromCloudinary = async (url) => {
    if (!url) return true;
    
    const publicId = extractPublicId(url);
    if (!publicId) {
        // Skip deletion if it's a local static asset (e.g., '/promo_card1.png')
        return true;
    }

    try {
        const result = await cloudinary.uploader.destroy(publicId);
        return result.result === 'ok';
    } catch (error) {
        console.error(`Failed to delete image from Cloudinary (Public ID: ${publicId}):`, error);
        return false;
    }
};

/**
 * Deletes multiple images from Cloudinary using their URLs.
 * 
 * @param {string[]} urls - Array of Cloudinary image URLs
 * @returns {Promise<void>}
 */
const deleteMultipleFromCloudinary = async (urls) => {
    if (!urls || !Array.isArray(urls) || urls.length === 0) return;
    
    const deletePromises = urls.map(url => deleteFromCloudinary(url));
    await Promise.all(deletePromises);
};

module.exports = {
    extractPublicId,
    deleteFromCloudinary,
    deleteMultipleFromCloudinary
};
