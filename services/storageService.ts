/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

/**
 * Resolves the GCS configuration from environment variables or localStorage overrides.
 */
export const getGCSConfig = () => {
  // Try environment variables (usually populated from .env.local in dev)
  const envBucket = process.env.GCS_BUCKET_NAME;
  const envToken = process.env.GCS_ACCESS_TOKEN || process.env.GCS_CREDENTIALS;

  // Try localStorage overrides (set via the UI)
  const localBucket = localStorage.getItem('gcs_bucket_override');
  const localToken = localStorage.getItem('gcs_token_override');

  return {
    bucket: localBucket || envBucket || '',
    token: localToken || envToken || '',
    isConfigured: !!(localBucket || envBucket) && !!(localToken || envToken),
    source: (localBucket || localToken) ? 'manual' : (envBucket || envToken) ? 'env' : 'none'
  };
};

/**
 * Uploads a base64 image to Google Cloud Storage.
 */
export const uploadToGCS = async (base64Data: string, id: string): Promise<boolean> => {
  const config = getGCSConfig();

  if (!config.isConfigured) {
    console.debug("GCS Upload skipped: Configuration missing.");
    return false;
  }

  try {
    const mimeMatch = base64Data.match(/^data:([^;]+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
    
    // Convert base64 to Blob
    const blob = await (await fetch(base64Data)).blob();
    
    const fileName = `infographic_${id}.png`;
    const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${config.bucket}/o?uploadType=media&name=${fileName}`;

    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Content-Type': mimeType,
      },
      body: blob,
    });

    if (!response.ok) {
      const errorText = await response.text();
      // If unauthorized, we might want to let the UI know
      if (response.status === 401 || response.status === 403) {
        console.error("GCS Auth Error: Token likely expired.");
      }
      throw new Error(`GCS API error (${response.status}): ${errorText}`);
    }

    console.log(`Successfully backed up ${fileName} to GCS bucket: ${config.bucket}`);
    return true;
  } catch (error) {
    console.error("Failed to automatically save graphic to GCS:", error);
    return false;
  }
};
