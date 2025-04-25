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
    
    const GITHUB_API = 'https://api.github.com/repos/Andres9890/ipa-encryption-checker';
    const GITHUB_WORKFLOW_ID = 'ipa-analysis.yml';
    
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
        
        resetUI();
        
        statusText.textContent = `Uploading ${file.name}...`;
        spinner.style.display = 'inline-block';
        
        const formData = new FormData();
        formData.append('file', file);
        
        const uploadId = generateUploadId();
        
        fetch('https://ipa-encryption-checker.b8ggigb.workers.dev/upload', {
            method: 'POST',
            body: formData,
            headers: {
                'X-Upload-ID': uploadId
            }
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(data => {
            statusText.textContent = 'Analyzing IPA file...';
            resultsContainer.style.display = 'block';
            
            pollAnalysisStatus(data.fileId, uploadId);
        })
        .catch(error => {
            showError('Error uploading file: ' + error.message);
        });
    }
    
    function pollAnalysisStatus(fileId, uploadId) {
        statusText.textContent = 'Analyzing IPA file...';
        resultsContainer.style.display = 'block';
        
        const checkStatus = () => {
            fetch(`https://ipa-encryption-checker.b8ggigb.workers.dev/status/${fileId}`, {
                method: 'GET',
                headers: {
                    'X-Upload-ID': uploadId
                }
            })
            .then(response => response.json())
            .then(data => {
                if (data.status === 'completed') {
                    if (data.success) {
                        displayResults(data.results);
                        
                        cleanupFile(fileId, uploadId);
                    } else {
                        showError('Analysis failed: ' + data.error);
                        cleanupFile(fileId, uploadId);
                    }
                } else if (data.status === 'failed') {
                    showError('Analysis failed: ' + data.error);
                    cleanupFile(fileId, uploadId);
                } else {
                    setTimeout(checkStatus, 2000);
                }
            })
            .catch(error => {
                showError('Error checking analysis status: ' + error.message);
            });
        };
        
        checkStatus();
    }
    
    function cleanupFile(fileId, uploadId) {
        fetch(`https://ipa-encryption-checker.b8ggigb.workers.dev/cleanup/${fileId}`, {
            method: 'DELETE',
            headers: {
                'X-Upload-ID': uploadId
            }
        })
        .then(response => {
            if (!response.ok) {
                console.warn('Failed to clean up file from CDN');
            }
        })
        .catch(error => {
            console.warn('Error cleaning up file:', error);
        });
    }
    
    function generateUploadId() {
        const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let result = '';
        for (let i = 0; i < 16; i++) {
            result += chars[Math.floor(Math.random() * chars.length)];
        }
        return result;
    }
    
    function displayResults(data) {
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
        spinner.style.display = 'none';
        statusText.textContent = 'Error';
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
    }
    
    function resetUI() {
        spinner.style.display = 'none';
        statusText.textContent = '';
        errorMessage.style.display = 'none';
        resultsContainer.style.display = 'none';
        resultsLoading.style.display = 'block';
        resultsContent.style.display = 'none';
    }
    
    function generateRandomMD5() {
        const chars = '0123456789abcdef';
        let result = '';
        for (let i = 0; i < 32; i++) {
            result += chars[Math.floor(Math.random() * chars.length)];
        }
        return result;
    }
});
