// Navigation loader for WizzCentral Platform
function loadNavigation() {
    fetch('../includes/sidebar.html')
        .then(response => response.text())
        .then(html => {
            const placeholder = document.getElementById('navigation-placeholder');
            if (placeholder) {
                placeholder.innerHTML = html;
            }
            
            // Set active navigation item based on current page
            setActiveNavItem();
            
            // Add sidebar toggle functionality
            addSidebarToggle();
        })
        .catch(error => {
            console.error('Error loading navigation:', error);
        });
}

function setActiveNavItem() {
    const currentPage = window.location.pathname.split('/').pop().replace('.html', '');
    const navItems = document.querySelectorAll('.nav-item');
    
    navItems.forEach(item => {
        const page = item.getAttribute('data-page');
        if (page === currentPage) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
}

function addSidebarToggle() {
    const toggleBtn = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
        });
    }
}

function logout() {
    // Clear session storage
    sessionStorage.clear();
    localStorage.clear();
    
    // Redirect to login
    window.location.href = '../index.html';
}
