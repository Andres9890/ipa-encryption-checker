document.addEventListener('DOMContentLoaded', () => {
    initDarkMode();
    
    const dropArea = document.getElementById('dropArea');
    const fileInput = document.getElementById('fileInput');
    const selectFileBtn = document.getElementById('selectFileBtn');
    const statusText = document.getElementById('statusText');
    const spinner = document.getElementById('spinner');
    const errorMessage = document.getElementById('errorMessage');
    const filesContainer = document.getElementById('filesContainer');
    const resultsContainerTemplate = document.getElementById('resultsContainerTemplate');

    let CLOUDFLARE_WORKER_URL = window.config?.CLOUDFLARE_WORKER_URL || 'https://ipa-encryption-checker.b8ggigb.workers.dev';
    CLOUDFLARE_WORKER_URL = CLOUDFLARE_WORKER_URL.endsWith('/') 
        ? CLOUDFLARE_WORKER_URL.slice(0, -1) 
        : CLOUDFLARE_WORKER_URL;
    
    const MAX_FILES = 5;
    const activeUploads = new Map();
    
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
    
    dropArea.addEventListener('click', (e) => {
        if (e.target !== selectFileBtn && !selectFileBtn.contains(e.target)) {
            fileInput.click();
        }
    });
    
    selectFileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
    });
    
    fileInput.addEventListener('change', handleFileSelect);
    
    dropArea.addEventListener('drop', handleFileDrop);
    
    function handleFileDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        
        handleFiles(files);
    }
    
    function handleFileSelect(e) {
        handleFiles(e.target.files);
    }
    
    function handleFiles(fileList) {
        const files = Array.from(fileList);
        
        const ipaFiles = files.filter(file => file.name.endsWith('.ipa'));
        
        if (ipaFiles.length === 0) {
            showError('Please upload valid .ipa file(s)');
            return;
        }
        
        const filesToProcess = ipaFiles.slice(0, MAX_FILES);
        
        if (ipaFiles.length > MAX_FILES) {
            showError(`Only the first ${MAX_FILES} IPA files will be processed. You selected ${ipaFiles.length} files.`);
        }
        
        resetUI();
        
        filesToProcess.forEach(file => {
            processFile(file);
        });
    }
    
    function processFile(file) {
        console.log(`Processing file: ${file.name}, size: ${file.size} bytes`);
        
        const fileId = generateUploadId();
        const resultContainer = createResultContainer(file, fileId);
        
        activeUploads.set(fileId, {
            file: file,
            status: 'uploading',
            container: resultContainer
        });
        
        uploadFile(file, fileId, resultContainer);
    }
    
    function createResultContainer(file, fileId) {
        const resultContainer = resultsContainerTemplate.firstElementChild.cloneNode(true);
        resultContainer.id = `result-${fileId}`;
        
        const loadingMsg = resultContainer.querySelector('.results-loading p');
        loadingMsg.textContent = `Analyzing ${file.name} (takes about 15-20 seconds)...`;
        
        filesContainer.appendChild(resultContainer);
        resultContainer.style.display = 'block';
        
        return resultContainer;
    }
    
    function uploadFile(file, fileId, resultContainer) {
        const formData = new FormData();
        formData.append('file', file);
        
        const uploadId = generateUploadId();
        console.log(`Generated upload ID: ${uploadId} for file ${fileId}`);
        
        const loadingElement = resultContainer.querySelector('.results-loading');
        loadingElement.querySelector('p').textContent = `Uploading ${file.name}...`;
        
        fetch(`${CLOUDFLARE_WORKER_URL}/upload`, {
            method: 'POST',
            body: formData,
            headers: {
                'X-Upload-ID': uploadId
            }
        })
        .then(response => {
            return response.text().then(text => {
                console.log(`Upload response for ${fileId}:`, text);
                
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
            console.log(`Upload successful for ${fileId}, response data:`, data);
            
            loadingElement.querySelector('p').textContent = `Analyzing ${file.name}...`;
            
            const fileData = activeUploads.get(fileId);
            fileData.status = 'analyzing';
            fileData.cloudFileId = data.fileId;
            fileData.uploadId = uploadId;
            activeUploads.set(fileId, fileData);
            
            pollAnalysisStatus(fileId);
        })
        .catch(error => {
            console.error(`Upload error for ${fileId}:`, error);
            showFileError(resultContainer, `Error uploading file: ${error.message}`);
        });
    }
    
    function pollAnalysisStatus(fileId) {
        const fileData = activeUploads.get(fileId);
        if (!fileData) return;
        
        const { cloudFileId, uploadId, container } = fileData;
        
        console.log(`Polling status for file: ${cloudFileId}`);
        
        const checkStatus = () => {
            console.log(`Checking status at: ${CLOUDFLARE_WORKER_URL}/status/${cloudFileId}`);
            
            fetch(`${CLOUDFLARE_WORKER_URL}/status/${cloudFileId}`, {
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
                console.log(`Status response for ${fileId}:`, data);
                
                if (data.status === 'completed') {
                    if (data.success) {
                        console.log(`Analysis completed successfully for ${fileId}`);
                        displayFileResults(container, data.results);
                        
                        const fileData = activeUploads.get(fileId);
                        fileData.status = 'completed';
                        activeUploads.set(fileId, fileData);
                        
                        cleanupFile(cloudFileId, uploadId);
                    } else {
                        console.error(`Analysis failed for ${fileId}:`, data.error);
                        showFileError(container, `Analysis failed: ${data.error}`);
                        cleanupFile(cloudFileId, uploadId);
                    }
                } else if (data.status === 'failed') {
                    console.error(`Analysis failed for ${fileId}:`, data.error);
                    showFileError(container, `Analysis failed: ${data.error}`);
                    cleanupFile(cloudFileId, uploadId);
                } else {
                    console.log(`Analysis still in progress for ${fileId}, status: ${data.status}`);
                    setTimeout(checkStatus, 2000);
                }
            })
            .catch(error => {
                console.error(`Error checking status for ${fileId}:`, error);
                showFileError(container, `Error checking analysis status: ${error.message}`);
            });
        };
        
        checkStatus();
    }
    
    function cleanupFile(cloudFileId, uploadId) {
        console.log(`Cleaning up file: ${cloudFileId}`);
        
        fetch(`${CLOUDFLARE_WORKER_URL}/cleanup/${cloudFileId}`, {
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
    
    function displayFileResults(container, data) {
        console.log('Displaying results:', data);
        
        const loadingElement = container.querySelector('.results-loading');
        const contentElement = container.querySelector('.results-content');
        
        loadingElement.style.display = 'none';
        contentElement.style.display = 'block';
        
        container.querySelector('.app-name').textContent = data.appName;
        container.querySelector('.display-name').textContent = data.displayName;
        container.querySelector('.bundle-id').textContent = data.bundleId;
        container.querySelector('.app-version').textContent = data.appVersion;
        container.querySelector('.min-ios').textContent = data.minIOS;
        container.querySelector('.architecture').textContent = data.architecture;
        
        const encryptionStatus = container.querySelector('.encryption-status');
        if (data.encrypted) {
            encryptionStatus.textContent = 'YES';
            encryptionStatus.className = 'encryption-status encrypted yes';
        } else {
            encryptionStatus.textContent = 'NO';
            encryptionStatus.className = 'encryption-status encrypted no';
        }
        
        container.querySelector('.obscura-filename').textContent = data.obscuraFilename;
    }
    
    function showFileError(container, message) {
        console.error('Error:', message);
        
        const loadingElement = container.querySelector('.results-loading');
        loadingElement.innerHTML = `<div class="error-message">${message}</div>`;
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
        filesContainer.innerHTML = '';
        activeUploads.clear();
    }
    
    function generateUploadId() {
        const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let result = '';
        for (let i = 0; i < 16; i++) {
            result += chars[Math.floor(Math.random() * chars.length)];
        }
        return result;
    }
    
    const faqItems = document.querySelectorAll('.faq-item');
    
    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        
        question.addEventListener('click', () => {
            item.classList.toggle('active');
            
            faqItems.forEach(otherItem => {
                if (otherItem !== item) {
                    otherItem.classList.remove('active');
                }
            });
        });
    });
});

function initDarkMode() {
    const darkModeToggle = document.getElementById('darkModeToggle');
    if (!darkModeToggle) return;
    
    const prefersDarkScheme = window.matchMedia('(prefers-color-scheme: dark)');
    
    const currentTheme = localStorage.getItem('theme') || 
                        (prefersDarkScheme.matches ? 'dark' : 'light');
    
    if (currentTheme === 'dark') {
        document.body.classList.add('dark-mode');
    }
    
    darkModeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        
        const theme = document.body.classList.contains('dark-mode') ? 'dark' : 'light';
        localStorage.setItem('theme', theme);
    });
}
