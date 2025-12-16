/**
 * Water of Leith WebMap - Main JS v4.1
 * 修改: 数字显示完整格式，不使用K/M缩写
 */

document.addEventListener('DOMContentLoaded', function() {
    // 初始化数字滚动动画
    initCounterAnimation();
    
    // 平滑滚动
    initSmoothScroll();
});

// ============================================================
// 数字滚动动画
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
    const format = element.getAttribute('data-format') || 'full'; // 默认使用完整格式
    const duration = 2000;
    const startTime = performance.now();
    
    function updateCounter(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // 使用easeOutExpo缓动函数
        const easeProgress = 1 - Math.pow(1 - progress, 4);
        const currentValue = Math.floor(easeProgress * target);
        
        // 始终使用完整格式显示数字
        const displayValue = currentValue.toLocaleString();
        
        element.textContent = prefix + displayValue + suffix;
        
        if (progress < 1) {
            requestAnimationFrame(updateCounter);
        } else {
            // 确保最终显示目标值（完整格式）
            element.textContent = prefix + target.toLocaleString() + suffix;
        }
    }
    
    requestAnimationFrame(updateCounter);
}

// ============================================================
// 平滑滚动（修复自动滚动到底部的bug）
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

// 页面加载时强制回到顶部
window.onload = function() {
    if (!window.location.hash) {
        setTimeout(function() {
            window.scrollTo(0, 0);
        }, 0);
    }
};

// 防止页面刷新时保持滚动位置
if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
}
