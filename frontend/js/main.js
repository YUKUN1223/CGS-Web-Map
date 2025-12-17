/**
 * Water of Leith WebMap - Main JS 
 */

document.addEventListener('DOMContentLoaded', function() {
   
    initCounterAnimation();
    
    
    initSmoothScroll();
});

// ============================================================
// Digital scrolling animation
// ============================================================
function initCounterAnimation() {
    const counters = document.querySelectorAll('[data-target]');
    
    if (counters.length === 0) return;
    
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.3
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const counter = entry.target;
                if (!counter.classList.contains('counted')) {
                    animateCounter(counter);
                    counter.classList.add('counted');
                }
            }
        });
    }, observerOptions);
    
    counters.forEach(counter => observer.observe(counter));
}

function animateCounter(element) {
    const target = parseInt(element.getAttribute('data-target'));
    const prefix = element.getAttribute('data-prefix') || '';
    const suffix = element.getAttribute('data-suffix') || '';
    const format = element.getAttribute('data-format') || 'full'; 
    const duration = 2000;
    const startTime = performance.now();
    
    function updateCounter(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
       
        const easeProgress = 1 - Math.pow(1 - progress, 4);
        const currentValue = Math.floor(easeProgress * target);
        
      
        const displayValue = currentValue.toLocaleString();
        
        element.textContent = prefix + displayValue + suffix;
        
        if (progress < 1) {
            requestAnimationFrame(updateCounter);
        } else {
        
            element.textContent = prefix + target.toLocaleString() + suffix;
        }
    }
    
    requestAnimationFrame(updateCounter);
}

// ============================================================
// Smooth scrolling
// ============================================================
function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;
            
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                e.preventDefault();
                targetElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
    
    if (window.location.hash === '' || window.location.hash === '#') {
        window.scrollTo(0, 0);
    }
}


window.onload = function() {
    if (!window.location.hash) {
        setTimeout(function() {
            window.scrollTo(0, 0);
        }, 0);
    }
};


if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
}
