document.addEventListener('DOMContentLoaded', () => {
    const dropArea = document.getElementById('dropArea');
    const fileInput = document.getElementById('fileInput');
    const selectFileBtn = document.getElementById('selectFileBtn');
    const statusText = document.getElementById('statusText');
    const spinner = document.getElementById('spinner');
    const errorMessage = document.getElementById('errorMessage');
    const resultsContainer = document.getElementById('resultsContainer');
    const resultsLoading = document.getElementById('resultsLoading');
    const resultsContent = document.getElementById('resultsContent');
    
    const CLOUDFLARE_WORKER_URL = window.config?.CLOUDFLARE_WORKER_URL || 'https://ipa-encryption-checker.b8ggigb.workers.dev/';
    
    console.log('IPA Encryption Checker initialized');
    console.log('Using Worker URL:', CLOUDFLARE_WORKER_URL);
    
    testWorkerConnection();
    
    function testWorkerConnection() {
        console.log('Testing Worker connection...');
        fetch(`${CLOUDFLARE_WORKER_URL}/test`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                console.log('Worker connection successful:', data);
            })
            .catch(error => {
                console.error('Worker connection test failed:', error);
            });
    }
    
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
    });
    
    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    ['dragenter', 'dragover'].forEach(eventName => {
        dropArea.addEventListener(eventName, highlight, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, unhighlight, false);
    });
    
    function highlight() {
        dropArea.classList.add('highlight');
    }
    
    function unhighlight() {
        dropArea.classList.remove('highlight');
    }
    
    selectFileBtn.addEventListener('click', () => {
        fileInput.click();
    });
    
    fileInput.addEventListener('change', handleFileSelect);
    
    dropArea.addEventListener('drop', handleFileDrop);
    
    function handleFileDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        
        if (files.length > 0) {
            handleFile(files[0]);
        }
    }
    
    function handleFileSelect(e) {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    }
    
    function handleFile(file) {
        if (!file.name.endsWith('.ipa')) {
            showError('Please upload a valid .ipa file');
            return;
        }
        
        console.log(`Processing file: ${file.name}, size: ${file.size} bytes`);
        
        resetUI();
        
        statusText.textContent = `Uploading ${file.name}...`;
        spinner.style.display = 'inline-block';
        
        const formData = new FormData();
        formData.append('file', file);
        
        const uploadId = generateUploadId();
        console.log(`Generated upload ID: ${uploadId}`);
        
        console.log(`Uploading to: ${CLOUDFLARE_WORKER_URL}/upload`);
        console.log('Headers:', { 'X-Upload-ID': uploadId });
        
        fetch(`${CLOUDFLARE_WORKER_URL}/upload`, {
            method: 'POST',
            body: formData,
            headers: {
                'X-Upload-ID': uploadId
            }
        })
        .then(response => {
            console.log('Upload response status:', response.status);
            console.log('Response headers:', response.headers);
            
            return response.text().then(text => {
                console.log('Response text:', text);
                
                if (!response.ok) {
                    throw new Error(`Network error: ${response.status} ${text}`);
                }
                
                try {
                    return JSON.parse(text);
                } catch (e) {
                    console.error('JSON parse error:', e);
                    throw new Error(`Invalid JSON response: ${text}`);
                }
            });
        })
        .then(data => {
            console.log('Upload successful, response data:', data);
            
            statusText.textContent = 'Analyzing IPA file...';
            resultsContainer.style.display = 'block';
            
            pollAnalysisStatus(data.fileId, uploadId);
        })
        .catch(error => {
            console.error('Upload error:', error);
            showError('Error uploading file: ' + error.message);
        });
    }
    
    function pollAnalysisStatus(fileId, uploadId) {
        console.log(`Polling status for file: ${fileId}`);
        
        statusText.textContent = 'Analyzing IPA file...';
        resultsContainer.style.display = 'block';
        
        const checkStatus = () => {
            console.log(`Checking status at: ${CLOUDFLARE_WORKER_URL}/status/${fileId}`);
            
            fetch(`${CLOUDFLARE_WORKER_URL}/status/${fileId}`, {
                method: 'GET',
                headers: {
                    'X-Upload-ID': uploadId
                }
            })
            .then(response => {
                if (!response.ok) {
                    return response.text().then(text => {
                        console.error(`Status check error: ${response.status}`, text);
                        throw new Error(`Status check failed: ${response.status} ${text}`);
                    });
                }
                return response.json();
            })
            .then(data => {
                console.log('Status response:', data);
                
                if (data.status === 'completed') {
                    if (data.success) {
                        console.log('Analysis completed successfully');
                        displayResults(data.results);
                        
                        cleanupFile(fileId, uploadId);
                    } else {
                        console.error('Analysis failed:', data.error);
                        showError('Analysis failed: ' + data.error);
                        cleanupFile(fileId, uploadId);
                    }
                } else if (data.status === 'failed') {
                    console.error('Analysis failed:', data.error);
                    showError('Analysis failed: ' + data.error);
                    cleanupFile(fileId, uploadId);
                } else {
                    console.log(`Analysis still in progress, status: ${data.status}`);
                    setTimeout(checkStatus, 2000);
                }
            })
            .catch(error => {
                console.error('Error checking status:', error);
                showError('Error checking analysis status: ' + error.message);
            });
        };
        
        checkStatus();
    }
    
    function cleanupFile(fileId, uploadId) {
        console.log(`Cleaning up file: ${fileId}`);
        
        fetch(`${CLOUDFLARE_WORKER_URL}/cleanup/${fileId}`, {
            method: 'DELETE',
            headers: {
                'X-Upload-ID': uploadId
            }
        })
        .then(response => {
            if (!response.ok) {
                console.warn(`Cleanup failed: ${response.status}`);
                return response.text().then(text => {
                    console.warn('Cleanup response:', text);
                });
            }
            console.log('Cleanup successful');
            return response.json();
        })
        .then(data => {
            console.log('Cleanup response data:', data);
        })
        .catch(error => {
            console.warn('Error cleaning up file:', error);
        });
    }
    
    function displayResults(data) {
        console.log('Displaying results:', data);
        
        resultsLoading.style.display = 'none';
        resultsContent.style.display = 'block';
        
        spinner.style.display = 'none';
        statusText.textContent = 'Analysis complete!';
        
        document.getElementById('appName').textContent = data.appName;
        document.getElementById('displayName').textContent = data.displayName;
        document.getElementById('bundleId').textContent = data.bundleId;
        document.getElementById('appVersion').textContent = data.appVersion;
        document.getElementById('minIOS').textContent = data.minIOS;
        document.getElementById('architecture').textContent = data.architecture;
        
        const encryptionStatus = document.getElementById('encryptionStatus');
        if (data.encrypted) {
            encryptionStatus.textContent = 'YES';
            encryptionStatus.className = 'encrypted yes';
        } else {
            encryptionStatus.textContent = 'NO';
            encryptionStatus.className = 'encrypted no';
        }
        
        document.getElementById('obscuraFilename').textContent = data.obscuraFilename;
    }
    
    function showError(message) {
        console.error('Error:', message);
        spinner.style.display = 'none';
        statusText.textContent = 'Error';
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
    }
    
    function resetUI() {
        console.log('Resetting UI');
        spinner.style.display = 'none';
        statusText.textContent = '';
        errorMessage.style.display = 'none';
        resultsContainer.style.display = 'none';
        resultsLoading.style.display = 'block';
        resultsContent.style.display = 'none';
    }
    
    function generateUploadId() {
        const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let result = '';
        for (let i = 0; i < 16; i++) {
            result += chars[Math.floor(Math.random() * chars.length)];
        }
        return result;
    }
});
