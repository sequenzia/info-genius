import { defineConfig, loadEnv } from 'vite';
import process from 'node:process';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // The third parameter '' allows loading all environment variables, 
  // even those without the VITE_ prefix.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    define: {
      // Inject environment variables into the client-side bundle
      'process.env.GCS_BUCKET_NAME': JSON.stringify(env.GCS_BUCKET_NAME),
      'process.env.GCS_ACCESS_TOKEN': JSON.stringify(env.GCS_ACCESS_TOKEN),
      'process.env.GCS_CREDENTIALS': JSON.stringify(env.GCS_CREDENTIALS),
      'process.env.API_KEY': JSON.stringify(env.API_KEY),
    },
    server: {
      // Ensure the dev server handles SPA routing if needed
      historyApiFallback: true,
    }
  };
});