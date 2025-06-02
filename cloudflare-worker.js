// THE Cloudflare Worker script for THE IPA Encryption Checker (made by Andres99)

// List of allowed origins for CORS requests
const ALLOWED_ORIGINS = [
  'https://placeholder.github.io' // place your actual github username (lowercase) (or place a custom domain)
];

// Cloudflare Worker entry point: handles all incoming requests
export default {
  async fetch(request, env, ctx) {
    // Handles the CORS preflight requests
    if (request.method === 'OPTIONS') {
      return handleCORS(request);
    }
    // Handles all other requests
    return handleRequest(request, env, ctx);
  }
};

// Main request handler: routes requests based on path and method
async function handleRequest(request, env, ctx) {
  const origin = request.headers.get('Origin') || '*';
  const corsHeaders = getCORSHeaders(origin);
  console.log(`Handling request: ${request.method} ${request.url}`);
  console.log(`Request headers: ${JSON.stringify(Object.fromEntries(request.headers.entries()))}`);
  try {
    const url = new URL(request.url);
    const path = url.pathname;
    const workerBaseUrl = `${url.protocol}//${url.host}`;
    env.WORKER_BASE_URL = workerBaseUrl;
    // Testing endpoint
    if (path === '/test' || path === '/') {
      return new Response(JSON.stringify({ 
        status: 'ok', 
        message: 'Worker is running correctly',
        timestamp: new Date().toISOString(),
        url: request.url,
        origin: origin
      }), { 
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    // File upload endpoint
    if (path === '/upload' && request.method === 'POST') {
      return await handleUpload(request, corsHeaders, env, ctx);
    } 
    // Status check endpoint
    else if (path.startsWith('/status/') && request.method === 'GET') {
      const fileId = path.split('/status/')[1];
      return await handleStatus(fileId, request, corsHeaders, env, ctx);
    } 
    // Cleanup endpoint (deletes the file and the session)
    else if (path.startsWith('/cleanup/') && request.method === 'DELETE') {
      const fileId = path.split('/cleanup/')[1];
      return await handleCleanup(fileId, request, corsHeaders, env, ctx);
    }
    // Update session endpoint
    else if (path.startsWith('/update/') && request.method === 'POST') {
      const fileId = path.split('/update/')[1];
      return await handleUpdate(fileId, request, corsHeaders, env, ctx);
    }
    // Serves the uploaded IPA file
    else if (path.startsWith('/file/') && request.method === 'GET') {
      const fileId = path.split('/file/')[1];
      return await handleFileServe(fileId, corsHeaders, env);
    }
    // A Fallback for unknown routes
    else {
      return new Response(JSON.stringify({
        error: 'Not found',
        path: path
      }), { 
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  } catch (err) {
    // Error handling
    console.error(`Error handling request: ${err.message}`);
    console.error(err.stack);
    return new Response(JSON.stringify({ 
      error: err.message,
      stack: err.stack
    }), { 
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
}

// Serves the IPA file from R2
async function handleFileServe(fileId, corsHeaders, env) {
  try {
    const r2Object = await env.R2_IPA_FILES.get(`${fileId}`);
    if (!r2Object) {
      return new Response(JSON.stringify({ error: 'File not found' }), { 
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    return new Response(r2Object.body, {
      headers: {
        'Content-Type': r2Object.httpMetadata?.contentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileId}"`,
        ...corsHeaders
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Error serving file: ${err.message}` }), { 
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
}

// Returns CORS headers based on the request's origin
function getCORSHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Upload-ID',
    'Access-Control-Max-Age': '86400',
  };
}

// Handles CORS preflight (OPTIONS) requests
function handleCORS(request) {
  const origin = request.headers.get('Origin') || '*';
  const corsHeaders = getCORSHeaders(origin);
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': corsHeaders['Access-Control-Allow-Origin'],
        'Access-Control-Allow-Methods': corsHeaders['Access-Control-Allow-Methods'],
        'Access-Control-Allow-Headers': corsHeaders['Access-Control-Allow-Headers'],
        'Access-Control-Allow-Credentials': corsHeaders['Access-Control-Allow-Credentials'],
        'Access-Control-Max-Age': corsHeaders['Access-Control-Max-Age'],
        'Content-Type': 'text/plain',
        'Content-Length': '0',
      }
    });
  }
  return new Response('Method not allowed', { 
    status: 405,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/plain'
    }
  });
}

// Handles file upload requests, stores file in R2, and creates a session in KV
async function handleUpload(request, corsHeaders, env, ctx) {
  console.log('Handling upload request');
  const uploadId = request.headers.get('X-Upload-ID');
  if (!uploadId) {
    return new Response(JSON.stringify({ error: 'Missing upload ID' }), { 
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return new Response(JSON.stringify({ 
      error: 'Expected multipart/form-data', 
      receivedContentType: contentType 
    }), { 
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
  try {
    console.log('Parsing form data');
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) {
      return new Response(JSON.stringify({ error: 'No file uploaded' }), { 
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    console.log(`File received: ${file.name}, size: ${file.size} bytes`);
    // Only allows IPA files
    if (!file.name.toLowerCase().endsWith('.ipa')) {
      return new Response(JSON.stringify({ 
        error: 'File must be an IPA', 
        filename: file.name 
      }), { 
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    // Generates a unique file ID
    const fileId = crypto.randomUUID();
    console.log(`Generated file ID: ${fileId}`);
    try {
      // Stores the file in R2
      console.log(`Storing file in R2: ${fileId}.ipa`);
      await env.R2_IPA_FILES.put(`${fileId}.ipa`, file);
      console.log('File stored successfully');
      // Creates a session in KV
      console.log(`Creating session in KV: ${fileId}`);
      const sessionData = {
        uploadId,
        fileName: file.name,
        timestamp: Date.now(),
        status: 'uploaded'
      };
      await env.KV_SESSIONS.put(fileId, JSON.stringify(sessionData), { expirationTtl: 3600 });
      console.log('Session created successfully');
      try {
        // Triggers the GitHub Actions workflow for analysis
        await triggerGitHubWorkflow(fileId, uploadId, env, ctx);
      } catch (workflowError) {
        console.error('Error triggering workflow, but continuing:', workflowError);
      }
      return new Response(JSON.stringify({ 
        fileId,
        message: 'File uploaded successfully',
        filename: file.name,
        size: file.size
      }), { 
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    } catch (storageError) {
      console.error('Error storing file:', storageError);
      return new Response(JSON.stringify({ 
        error: `Failed to store file: ${storageError.message}` 
      }), { 
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  } catch (err) {
    console.error('Error handling upload:', err);
    return new Response(JSON.stringify({ 
      error: `Error processing upload: ${err.message}`,
      stack: err.stack
    }), { 
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
}

// Triggers the GitHub Actions workflow to analyze the uploaded IPA file
async function triggerGitHubWorkflow(fileId, uploadId, env, ctx) {
  console.log(`Triggering GitHub workflow for file: ${fileId}`);
  try {
    // Updates the session status to processing
    const sessionData = JSON.parse(await env.KV_SESSIONS.get(fileId) || '{"status":"unknown"}');
    sessionData.status = 'processing';
    // Checks if the file exists in R2
    const r2Object = await env.R2_IPA_FILES.head(`${fileId}.ipa`);
    if (!r2Object) {
      throw new Error(`IPA file not found in R2 storage: ${fileId}.ipa`);
    }
    console.log(`File exists in R2, size: ${r2Object.size} bytes`);
    // Constructs the file URL for the GitHub workflow
    const workerBaseUrl = env.WORKER_BASE_URL || 'https://placeholder.url.workers.dev'; // replace with your actual worker's URL 
    const fileUrl = `${workerBaseUrl}/file/${fileId}.ipa`;
    console.log(`File access URL: ${fileUrl}`);
    sessionData.fileSize = r2Object.size;
    sessionData.fileUploadDate = new Date().toISOString();
    await env.KV_SESSIONS.put(fileId, JSON.stringify(sessionData), { expirationTtl: 3600 });
    // Prepares the GitHub API request
    const GITHUB_PAT = env.GITHUB_PAT; // make a GITHUB_PAT secert in your cloudflare worker with your github token
    const GITHUB_USERNAME = env.GITHUB_USERNAME || 'placeholder'; // replace with your actual github username
    const REPO_NAME = env.REPO_NAME || 'placeholder'; // replace with your actual github repo name
    console.log(`Sending GitHub API request to ${GITHUB_USERNAME}/${REPO_NAME}`);
    if (!GITHUB_PAT) {
      throw new Error('GitHub PAT not configured. Please set the GITHUB_PAT environment variable.');
    }
    // Triggers the repository_dispatch event
    const response = await fetch(`https://api.github.com/repos/${GITHUB_USERNAME}/${REPO_NAME}/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${GITHUB_PAT}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'IPA-Encryption-Checker'
      },
      body: JSON.stringify({
        event_type: 'analyze-ipa',
        client_payload: {
          file_url: fileUrl,
          file_id: fileId,
          upload_id: uploadId
        }
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to trigger GitHub workflow: ${response.status} ${errorText}`);
    }
    console.log('GitHub workflow triggered successfully');
    return true;
  } catch (err) {
    console.error('Error triggering GitHub workflow:', err);
    try {
      // Updates the session with the error code status
      const sessionData = JSON.parse(await env.KV_SESSIONS.get(fileId) || '{}');
      sessionData.status = 'failed';
      sessionData.error = `Failed to trigger analysis: ${err.message}`;
      await env.KV_SESSIONS.put(fileId, JSON.stringify(sessionData), { expirationTtl: 3600 });
    } catch (kvError) {
      console.error('Error updating session with error:', kvError);
    }
    throw err;
  }
}

// Handles the status check requests for a given file/session
async function handleStatus(fileId, request, corsHeaders, env, ctx) {
  console.log(`Checking status for file: ${fileId}`);
  const uploadId = request.headers.get('X-Upload-ID');
  if (!uploadId) {
    return new Response(JSON.stringify({ error: 'Missing upload ID' }), { 
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
  try {
    const sessionData = await env.KV_SESSIONS.get(fileId);
    if (!sessionData) {
      return new Response(JSON.stringify({ error: 'File not found' }), { 
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    const session = JSON.parse(sessionData);
    // Only allows access if the uploadId matches
    if (session.uploadId !== uploadId) {
      return new Response(JSON.stringify({ error: 'Invalid upload ID' }), { 
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    return new Response(JSON.stringify({
      status: session.status,
      success: session.success,
      results: session.results,
      error: session.error
    }), { 
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Error checking status: ${err.message}` }), { 
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
}

// Handles the update requests to modify the session data
async function handleUpdate(fileId, request, corsHeaders, env, ctx) {
  console.log(`Handling update for file: ${fileId}`);
  const uploadId = request.headers.get('X-Upload-ID');
  if (!uploadId) {
    return new Response(JSON.stringify({ error: 'Missing upload ID' }), { 
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
  try {
    const sessionData = await env.KV_SESSIONS.get(fileId);
    if (!sessionData) {
      return new Response(JSON.stringify({ error: 'File not found' }), { 
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    const session = JSON.parse(sessionData);
    // Only allows update if the uploadId matches
    if (session.uploadId !== uploadId) {
      return new Response(JSON.stringify({ error: 'Invalid upload ID' }), { 
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    try {
      // Merges the update data into the session
      const updateData = await request.json();
      console.log('Update data:', updateData);
      Object.assign(session, updateData);
      await env.KV_SESSIONS.put(fileId, JSON.stringify(session), { expirationTtl: 3600 });
      return new Response(JSON.stringify({ 
        message: 'Session updated successfully' 
      }), { 
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    } catch (err) {
      return new Response(JSON.stringify({ 
        error: `Failed to parse update data: ${err.message}` 
      }), { 
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({ 
      error: `Failed to update session: ${err.message}` 
    }), { 
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
}

// Handles the cleanup requests: deletes the file from R2 and the session from KV
async function handleCleanup(fileId, request, corsHeaders, env, ctx) {
  console.log(`Handling cleanup for file: ${fileId}`);
  const uploadId = request.headers.get('X-Upload-ID');
  if (!uploadId) {
    return new Response(JSON.stringify({ error: 'Missing upload ID' }), { 
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
  try {
    const sessionData = await env.KV_SESSIONS.get(fileId);
    if (!sessionData) {
      return new Response(JSON.stringify({ error: 'File not found' }), { 
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    const session = JSON.parse(sessionData);
    // Only allows cleanup if the uploadId matches
    if (session.uploadId !== uploadId) {
      return new Response(JSON.stringify({ error: 'Invalid upload ID' }), { 
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
    // Deletes the file from R2
    console.log(`Deleting file from R2: ${fileId}.ipa`);
    await env.R2_IPA_FILES.delete(`${fileId}.ipa`);
    // Deletes the session from KV
    console.log(`Deleting session from KV: ${fileId}`);
    await env.KV_SESSIONS.delete(fileId);
    return new Response(JSON.stringify({ 
      message: 'File and session deleted successfully' 
    }), { 
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ 
      error: `Failed to clean up: ${err.message}` 
    }), { 
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
}
