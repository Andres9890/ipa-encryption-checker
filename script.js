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
    const modeToggleIcon = document.getElementById('modeToggleIcon');
    const urlInputContainer = document.getElementById('urlInputContainer');
    const urlInput = document.getElementById('urlInput');
    const submitUrlBtn = document.getElementById('submitUrlBtn');

    let CLOUDFLARE_WORKER_URL = window.config?.CLOUDFLARE_WORKER_URL || 'https://api.ipachecker.qzz.io';
    CLOUDFLARE_WORKER_URL = CLOUDFLARE_WORKER_URL.endsWith('/')
        ? CLOUDFLARE_WORKER_URL.slice(0, -1)
        : CLOUDFLARE_WORKER_URL;

    const MAX_FILES = 5;
    const activeUploads = new Map();
    let userIP = null;
    let isUrlMode = false;
    
    console.log('IPA Encryption Checker initialized');
    console.log('Using Worker URL:', CLOUDFLARE_WORKER_URL);
    
    testWorkerConnection();

    modeToggleIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        isUrlMode = !isUrlMode;

        if (isUrlMode) {
            dropArea.classList.add('url-mode');
            urlInputContainer.style.display = 'flex';
            modeToggleIcon.title = 'File upload mode';
            modeToggleIcon.querySelector('i').className = 'fas fa-cloud-upload-alt';
        } else {
            dropArea.classList.remove('url-mode');
            urlInputContainer.style.display = 'none';
            modeToggleIcon.title = 'URL mode';
            modeToggleIcon.querySelector('i').className = 'fas fa-link';
            urlInput.value = '';
        }
    });

    submitUrlBtn.addEventListener('click', () => {
        const url = urlInput.value.trim();

        if (!url) {
            showError('Please enter a URL');
            return;
        }

        if (!url.toLowerCase().endsWith('.ipa')) {
            showError('URL must end with .ipa');
            return;
        }

        try {
            new URL(url);
        } catch (e) {
            showError('Please enter a valid URL');
            return;
        }

        turnstileToken = null;
        pendingUrl = url;
        showCaptcha();
    });

    urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            submitUrlBtn.click();
        }
    });

    let turnstileWidgetId = null;
    let turnstileToken = null;
    const turnstileWrapper = document.getElementById('cf-turnstile-wrapper');
    let pendingFileList = null;
    let pendingUrl = null;
    function showCaptcha() {
        if (turnstileWrapper.style.display !== 'block') {
            turnstileWrapper.style.display = 'block';
            if (!window.turnstile) {
                const script = document.createElement('script');
                script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
                script.async = true;
                script.defer = true;
                document.body.appendChild(script);
                script.onload = renderCaptcha;
            } else {
                renderCaptcha();
            }
        }
    }
    function renderCaptcha() {
        if (turnstileWidgetId !== null) return;
        turnstileWidgetId = window.turnstile.render('#cf-turnstile-wrapper', {
            sitekey: '0x4AAAAAAB2Y8Apb9QGveJmP',
            callback: function(token) {
                turnstileToken = token;
                setTimeout(() => {
                    turnstileWrapper.innerHTML = '';
                    turnstileWrapper.style.display = 'none';
                    turnstileWidgetId = null;
                    if (pendingFileList) {
                        handleFiles(pendingFileList, true);
                        pendingFileList = null;
                    } else if (pendingUrl) {
                        handleUrl(pendingUrl, true);
                        pendingUrl = null;
                    }
                }, 200);
            },
            'expired-callback': function() {
                turnstileToken = null;
            },
            'error-callback': function() {
                turnstileToken = null;
            }
        });
    }
    function resetCaptcha() {
        if (window.turnstile && turnstileWidgetId !== null) {
            window.turnstile.reset(turnstileWidgetId);
            turnstileToken = null;
        }
        turnstileWrapper.style.display = 'none';
        turnstileWidgetId = null;
    }
    
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
                if (data.ip) {
                    userIP = data.ip;
                    console.log('User IP from worker:', userIP);
                }
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
        if (!isUrlMode && e.target !== selectFileBtn && !selectFileBtn.contains(e.target)) {
            fileInput.click();
        }
    });
    
    selectFileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
    });
    
    fileInput.addEventListener('change', (e) => {
        turnstileToken = null;
        pendingFileList = e.target.files;
        showCaptcha();
    });
    
    dropArea.addEventListener('drop', (e) => {
        turnstileToken = null;
        pendingFileList = e.dataTransfer.files;
        showCaptcha();
    });
    
    function handleFiles(fileList, skipCaptchaCheck) {
        const files = Array.from(fileList);
        const ipaFiles = files.filter(file => file.name.endsWith('.ipa'));
        if (ipaFiles.length === 0) {
            showError('Please upload valid .ipa file(s)');
            return;
        }
        if (!turnstileToken && !skipCaptchaCheck) {
            pendingFileList = fileList;
            showCaptcha();
            return;
        }
        const filesToProcess = ipaFiles.slice(0, MAX_FILES);
        if (ipaFiles.length > MAX_FILES) {
            showError(`Only the first ${MAX_FILES} IPA files will be processed. You selected ${ipaFiles.length} files.`);
        }
        resetUI();
        filesToProcess.forEach(file => {
            processFile(file, turnstileToken);
        });
    }
    
    function handleUrl(url, skipCaptchaCheck) {
        if (!turnstileToken && !skipCaptchaCheck) {
            pendingUrl = url;
            showCaptcha();
            return;
        }

        resetUI();
        processUrl(url, turnstileToken);
    }

    function processUrl(url, turnstileToken) {
        console.log(`Processing URL: ${url}`);
        const fileId = generateUploadId();
        const fileName = url.split('/').pop() || 'ipa-from-url.ipa';
        const dummyFile = { name: fileName };
        const resultContainer = createResultContainer(dummyFile, fileId);
        activeUploads.set(fileId, {
            url: url,
            status: 'uploading',
            container: resultContainer
        });
        uploadUrl(url, fileId, resultContainer, turnstileToken);
    }

    function processFile(file, turnstileToken) {
        console.log(`Processing file: ${file.name}, size: ${file.size} bytes`);
        const fileId = generateUploadId();
        const resultContainer = createResultContainer(file, fileId);
        activeUploads.set(fileId, {
            file: file,
            status: 'uploading',
            container: resultContainer
        });
        uploadFile(file, fileId, resultContainer, turnstileToken);
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
    
    function uploadFile(file, fileId, resultContainer, turnstileToken) {
        const formData = new FormData();
        formData.append('file', file);
        if (turnstileToken) {
            formData.append('cf-turnstile-response', turnstileToken);
        }
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

            if (data.ip) {
                userIP = data.ip;
                console.log('User IP from upload response:', userIP);
            }

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

    function uploadUrl(url, fileId, resultContainer, turnstileToken) {
        const uploadId = generateUploadId();
        console.log(`Generated upload ID: ${uploadId} for URL ${fileId}`);
        const loadingElement = resultContainer.querySelector('.results-loading');
        const fileName = url.split('/').pop();
        loadingElement.querySelector('p').textContent = `Processing URL...`;

        const requestBody = {
            url: url
        };

        if (turnstileToken) {
            requestBody.turnstileToken = turnstileToken;
        }

        fetch(`${CLOUDFLARE_WORKER_URL}/upload`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Upload-ID': uploadId
            },
            body: JSON.stringify(requestBody)
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
            console.log(`URL processing successful for ${fileId}, response data:`, data);

            if (data.ip) {
                userIP = data.ip;
                console.log('User IP from upload response:', userIP);
            }

            loadingElement.querySelector('p').textContent = `Analyzing ${fileName}...`;

            const urlData = activeUploads.get(fileId);
            urlData.status = 'analyzing';
            urlData.cloudFileId = data.fileId;
            urlData.uploadId = uploadId;
            activeUploads.set(fileId, urlData);

            pollAnalysisStatus(fileId);
        })
        .catch(error => {
            console.error(`URL upload error for ${fileId}:`, error);
            showFileError(resultContainer, `Error processing URL: ${error.message}`);
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
                
                if (data.ip) {
                    userIP = data.ip;
                    console.log('User IP from status response:', userIP);
                }
                
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
                console.error(`Status check error for ${fileId}:`, error);
                showFileError(container, `Error checking status: ${error.message}`);
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

        const downloadIpaBtn = container.querySelector('.download-ipa-btn');
        const downloadResultsBtn = container.querySelector('.download-results-btn');
        downloadIpaBtn.disabled = true;
        downloadResultsBtn.disabled = true;

        if (data.downloadLinks && data.downloadLinks.ipa) {
            downloadIpaBtn.onclick = () => window.open(data.downloadLinks.ipa, '_blank');
            downloadIpaBtn.disabled = false;
        }
        if (data.downloadLinks && data.downloadLinks.results) {
            downloadResultsBtn.onclick = () => window.open(data.downloadLinks.results, '_blank');
            downloadResultsBtn.disabled = false;
        }
    }
    
    function showFileError(container, message) {
    console.error('Error:', message);

    const loadingElement = container.querySelector('.results-loading');

    loadingElement.textContent = ''; 

    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;

    loadingElement.appendChild(errorDiv);
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
        resetCaptcha();
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
