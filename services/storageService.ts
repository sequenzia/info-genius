/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

/**
 * Uploads a base64 image to Google Cloud Storage.
 * Uses GCS_BUCKET_NAME and GCS_ACCESS_TOKEN from environment variables.
 */
export const uploadToGCS = async (base64Data: string, id: string): Promise<void> => {
  const bucket = process.env.GCS_BUCKET_NAME;
  // Support both GCS_ACCESS_TOKEN and GCS_CREDENTIALS as environment variable names for the token
  const token = process.env.GCS_ACCESS_TOKEN || process.env.GCS_CREDENTIALS;

  if (!bucket || !token) {
    console.warn("GCS Upload skipped: GCS_BUCKET_NAME or GCS_ACCESS_TOKEN (credentials) environment variables are not defined.");
    return;
  }

  try {
    // Detect mime type
    const mimeMatch = base64Data.match(/^data:([^;]+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
    
    // Convert base64 to Blob using fetch trick
    const blob = await (await fetch(base64Data)).blob();
    
    const fileName = `infographic_${id}.png`;
    const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${fileName}`;

    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': mimeType,
      },
      body: blob,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GCS API error (${response.status}): ${errorText}`);
    }

    console.log(`Successfully backed up ${fileName} to GCS bucket: ${bucket}`);
  } catch (error) {
    console.error("Failed to automatically save graphic to GCS:", error);
  }
};
