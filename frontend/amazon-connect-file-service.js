// Amazon Connect File Attachment Service
// Handles file uploads, downloads, and management for chat sessions

class AmazonConnectFileService {
    constructor() {
        const cfg = (typeof window !== 'undefined' && window.WIZZCENTRAL_CONFIG) ? window.WIZZCENTRAL_CONFIG : {};
        this.apiBaseUrl = cfg.AMAZON_CONNECT_API_BASE_URL || cfg.API_BASE_URL || '';
        if (!this.apiBaseUrl) {
            throw new Error('Missing API base URL. Set window.__API_BASE_URL__ (or window.__AMAZON_CONNECT_API_BASE_URL__).');
        }
        if (String(this.apiBaseUrl).includes('/dev')) {
            throw new Error(`Refusing to use dev Amazon Connect API base URL in staging: ${this.apiBaseUrl}`);
        }
        this.maxFileSize = 5 * 1024 * 1024; // 5MB to avoid timeout issues
        this.allowedTypes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf', 'text/plain', 'text/csv',
            'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ];
        this.uploadProgress = new Map();
    }

    /**
     * Upload file for chat session using S3 presigned URLs
     */
    async uploadFile(file, contactId, messageId = null) {
        try {
            // Validate file
            this.validateFile(file);

            console.log('📎 Uploading file for chat:', {
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type,
                contactId
            });

            // Initialize progress tracking
            const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            this.uploadProgress.set(uploadId, {
                progress: 0,
                status: 'uploading',
                fileName: file.name,
                fileSize: file.size
            });

            // Step 1: Get presigned URL from backend
            const presignedResponse = await fetch(`${this.apiBaseUrl}/chat/files/upload`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify({
                    sessionId: contactId,
                    fileName: file.name,
                    fileSize: file.size,
                    fileType: file.type
                })
            });

            if (!presignedResponse.ok) {
                throw new Error(`Failed to get upload URL: ${presignedResponse.status}`);
            }

            const { fileId, uploadUrl } = await presignedResponse.json();

            // Step 2: Upload directly to S3 with progress tracking
            await this.uploadToS3WithProgress(file, uploadUrl, uploadId);

            // Step 3: Complete the upload
            const completeResponse = await fetch(`${this.apiBaseUrl}/chat/files/${fileId}/confirm`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify({
                    actualSize: file.size
                })
            });

            if (!completeResponse.ok) {
                throw new Error(`Failed to complete upload: ${completeResponse.status}`);
            }

            const result = await completeResponse.json();

            // Update progress to complete
            this.uploadProgress.set(uploadId, {
                progress: 100,
                status: 'completed',
                fileName: file.name,
                fileSize: file.size,
                fileUrl: result.downloadUrl,
                fileId: result.fileId
            });

            console.log('✅ File uploaded successfully:', result);

            // Emit upload complete event
            this.emitFileEvent('upload-complete', {
                uploadId,
                fileId: result.fileId,
                fileName: file.name,
                fileUrl: result.downloadUrl,
                fileSize: file.size,
                contactId
            });

            return result;

        } catch (error) {
            console.error('❌ File upload failed:', error);
            this.emitFileEvent('upload-error', { error: error.message });
            throw error;
        }
    }

    /**
     * Upload directly to S3 with progress tracking and chunked support
     */
    async uploadToS3WithProgress(file, uploadUrl, uploadId) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            // Track upload progress
            xhr.upload.addEventListener('progress', (event) => {
                if (event.lengthComputable) {
                    const progress = Math.round((event.loaded / event.total) * 100);

                    this.uploadProgress.set(uploadId, {
                        ...this.uploadProgress.get(uploadId),
                        progress: progress
                    });

                    // Emit progress event
                    this.emitFileEvent('upload-progress', {
                        uploadId,
                        progress,
                        loaded: event.loaded,
                        total: event.total
                    });
                }
            });

            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve();
                } else {
                    reject(new Error(`S3 upload failed: ${xhr.status} ${xhr.statusText}`));
                }
            });

            xhr.addEventListener('error', () => {
                reject(new Error('Network error during S3 upload'));
            });

            xhr.addEventListener('timeout', () => {
                reject(new Error('Upload timeout - file too large or connection too slow'));
            });

            xhr.addEventListener('abort', () => {
                reject(new Error('Upload was cancelled'));
            });

            // Set shorter timeout for better user experience
            xhr.timeout = 2 * 60 * 1000; // 2 minutes

            // Add error handling for large files
            if (file.size > this.maxFileSize) {
                reject(new Error(`File too large: ${this.formatFileSize(file.size)}. Maximum allowed: ${this.formatFileSize(this.maxFileSize)}`));
                return;
            }

            xhr.open('PUT', uploadUrl);
            xhr.setRequestHeader('Content-Type', file.type);

            // Add additional headers for better S3 compatibility
            xhr.setRequestHeader('x-amz-content-sha256', 'UNSIGNED-PAYLOAD');

            xhr.send(file);
        });
    }

    /**
     * Download file from chat session
     */
    async downloadFile(fileId, fileName) {
        try {
            console.log('⬇️ Downloading file:', { fileId, fileName });

            const response = await fetch(`${this.apiBaseUrl}/chat/file-download-url/${fileId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.getAuthToken()}`
                }
            });

            if (!response.ok) {
                throw new Error(`File download failed: ${response.status}`);
            }

            const { downloadUrl } = await response.json();

            // Download from S3 URL
            const fileResponse = await fetch(downloadUrl);
            if (!fileResponse.ok) {
                throw new Error(`Failed to download file from S3: ${fileResponse.status}`);
            }

            const blob = await fileResponse.blob();

            // Create download link
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            console.log('✅ File downloaded successfully');

        } catch (error) {
            console.error('❌ File download failed:', error);
            throw error;
        }
    }

    /**
     * Get file info from chat session
     */
    async getFileInfo(fileId) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/chat/file-info/${fileId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.getAuthToken()}`
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to get file info: ${response.status}`);
            }

            return await response.json();

        } catch (error) {
            console.error('❌ Failed to get file info:', error);
            throw error;
        }
    }

    /**
     * Delete file from chat session
     */
    async deleteFile(fileId, contactId) {
        try {
            console.log('🗑️ Deleting file:', { fileId, contactId });

            const response = await fetch(`${this.apiBaseUrl}/chat/delete-file`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify({
                    fileId,
                    contactId
                })
            });

            if (!response.ok) {
                throw new Error(`File deletion failed: ${response.status}`);
            }

            const result = await response.json();
            console.log('✅ File deleted successfully');

            this.emitFileEvent('file-deleted', { fileId, contactId });

            return result;

        } catch (error) {
            console.error('❌ File deletion failed:', error);
            throw error;
        }
    }

    /**
     * Validate file before upload
     */
    validateFile(file) {
        // Check file size
        if (file.size > this.maxFileSize) {
            throw new Error(`File size (${this.formatFileSize(file.size)}) exceeds maximum allowed size (${this.formatFileSize(this.maxFileSize)})`);
        }

        // Check file type
        if (!this.allowedTypes.includes(file.type)) {
            throw new Error(`File type "${file.type}" is not allowed. Allowed types: ${this.allowedTypes.join(', ')}`);
        }

        // Check file name
        if (file.name.length > 255) {
            throw new Error('File name too long (maximum 255 characters)');
        }

        return true;
    }

    /**
     * Check if file can be uploaded (size check before starting upload)
     */
    canUploadFile(file) {
        try {
            this.validateFile(file);
            return { canUpload: true };
        } catch (error) {
            return {
                canUpload: false,
                error: error.message,
                fileSize: this.formatFileSize(file.size),
                maxSize: this.formatFileSize(this.maxFileSize)
            };
        }
    }

    /**
     * Get upload progress
     */
    getUploadProgress(uploadId) {
        return this.uploadProgress.get(uploadId);
    }

    /**
     * Get all active uploads
     */
    getActiveUploads() {
        return Array.from(this.uploadProgress.entries())
            .filter(([id, progress]) => progress.status === 'uploading')
            .map(([id, progress]) => ({ uploadId: id, ...progress }));
    }

    /**
     * Cancel upload
     */
    cancelUpload(uploadId) {
        const progress = this.uploadProgress.get(uploadId);
        if (progress && progress.status === 'uploading') {
            this.uploadProgress.set(uploadId, {
                ...progress,
                status: 'cancelled'
            });

            this.emitFileEvent('upload-cancelled', { uploadId });
        }
    }

    /**
     * Format file size for display
     */
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';

        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Get file icon based on type
     */
    getFileIcon(fileType) {
        const iconMap = {
            'image/jpeg': 'fa-image',
            'image/png': 'fa-image',
            'image/gif': 'fa-image',
            'image/webp': 'fa-image',
            'application/pdf': 'fa-file-pdf',
            'text/plain': 'fa-file-text',
            'text/csv': 'fa-file-csv',
            'application/msword': 'fa-file-word',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'fa-file-word',
            'application/vnd.ms-excel': 'fa-file-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'fa-file-excel'
        };

        return iconMap[fileType] || 'fa-file';
    }

    /**
     * Check if file is an image
     */
    isImageFile(fileType) {
        return fileType.startsWith('image/');
    }

    /**
     * Get auth token (integrate with existing auth system)
     */
    getAuthToken() {
        if (typeof window.Auth !== 'undefined' && window.Auth.getToken) {
            // Try to get access token first, then ID token as fallback
            return window.Auth.getToken('accessToken') ||
                window.Auth.getToken('idToken') ||
                localStorage.getItem('accessToken') ||
                localStorage.getItem('idToken');
        }

        // Fallback to direct session storage access
        return localStorage.getItem('accessToken') ||
            localStorage.getItem('idToken') ||
            localStorage.getItem('authToken');
    }

    /**
     * Emit file-related events
     */
    emitFileEvent(eventType, data) {
        const event = new CustomEvent(`amazon-connect-file-${eventType}`, {
            detail: data
        });
        window.dispatchEvent(event);
    }

    /**
     * Create file attachment UI element
     */
    createFileAttachmentElement(fileData) {
        const attachment = document.createElement('div');
        attachment.className = 'file-attachment';
        attachment.dataset.fileId = fileData.fileId;

        const isImage = this.isImageFile(fileData.fileType);
        const icon = this.getFileIcon(fileData.fileType);

        attachment.innerHTML = `
            <div class="file-attachment-content">
                ${isImage ? `
                    <div class="file-thumbnail">
                        <img src="${fileData.fileUrl}" alt="${fileData.fileName}" loading="lazy">
                    </div>
                ` : `
                    <div class="file-icon">
                        <i class="fas ${icon}"></i>
                    </div>
                `}
                <div class="file-info">
                    <div class="file-name" title="${fileData.fileName}">${fileData.fileName}</div>
                    <div class="file-size">${this.formatFileSize(fileData.fileSize)}</div>
                </div>
                <div class="file-actions">
                    <button class="btn-download" onclick="amazonConnectFileService.downloadFile('${fileData.fileId}', '${fileData.fileName}')" title="Download">
                        <i class="fas fa-download"></i>
                    </button>
                    <button class="btn-delete" onclick="amazonConnectFileService.deleteFile('${fileData.fileId}', '${fileData.contactId}')" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;

        return attachment;
    }

    /**
     * Initialize file drag and drop
     */
    initializeFileDragDrop(chatContainer, contactId) {
        const dropZone = chatContainer.querySelector('.chat-input-container');
        if (!dropZone) return;

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });

        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
        });

        dropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');

            const files = Array.from(e.dataTransfer.files);
            for (const file of files) {
                try {
                    await this.uploadFile(file, contactId);
                } catch (error) {
                    console.error('File upload failed:', error);
                    this.showFileError(error.message);
                }
            }
        });
    }

    /**
     * Show file error message
     */
    showFileError(message) {
        if (typeof window.showMessage === 'function') {
            window.showMessage(`File Error: ${message}`, 'error');
        } else {
            alert(`File Error: ${message}`);
        }
    }
}

// Global instance
window.amazonConnectFileService = new AmazonConnectFileService();

// Export for CommonJS if available
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AmazonConnectFileService;
}

console.log('✅ Amazon Connect File Service loaded');
