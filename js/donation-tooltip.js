// Donation tooltip functionality
    let donationTooltipVisible = false;
    const donationTooltip = document.getElementById('donation-tooltip');
    const donateIconLink = document.querySelector('.contact-section a:nth-child(2)');
    const tooltipCloseBtn = document.querySelector('.tooltip-close');
    const downloadBtn = document.querySelector('.download-qr-btn');

    function toggleDonationTooltip() {
      donationTooltipVisible = !donationTooltipVisible;
      if (donationTooltipVisible) {
        // Calculate position above the donate icon
        const iconRect = donateIconLink.getBoundingClientRect();

        // Center horizontally in the screen
        const tooltipWidth = window.innerWidth-20; // Approximate width
        const tooltipHeight = window.innerHeight-150; // Approximate height
        let left = (window.innerWidth - tooltipWidth);
        let top = (window.innerHeight - tooltipHeight);


        // Ensure tooltip stays within viewport
        if (left < 10) left = 10;
        if (left + tooltipWidth > window.innerWidth - 10) left = window.innerWidth - tooltipWidth - 10;
        if (top < 10) top = iconRect.bottom + 10; // Show below if no space above

        donationTooltip.style.left = left + 'px';
        donationTooltip.style.top = top + 'px';
        donationTooltip.style.bottom = 'auto';
        donationTooltip.classList.add('active');
      } else {
        donationTooltip.classList.remove('active');
      }
    }

    function closeDonationTooltip() {
      donationTooltipVisible = false;
      donationTooltip.classList.remove('active');
    }

    function downloadQRCode() {
      const qrImg = document.querySelector('.qr-code');
      const imgSrc = qrImg.src;

      // Create download link
      const link = document.createElement('a');
      link.href = imgSrc;
      link.download = 'qr-donate-to-resonate-via-nequi.jpg';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Show success message
      showStatus('QR downloaded successfully', 'info', 2000);
    }

    // Add event listeners when DOM is loaded
    document.addEventListener('DOMContentLoaded', function() {
      // Click on donate icon
      if (donateIconLink) {
        donateIconLink.addEventListener('click', function(e) {
          e.preventDefault();
          toggleDonationTooltip();
        });
      }

      // Close button
      if (tooltipCloseBtn) {
        tooltipCloseBtn.addEventListener('click', closeDonationTooltip);
      }

      // Download button
      if (downloadBtn) {
        downloadBtn.addEventListener('click', downloadQRCode);
      }

      // Close tooltip when clicking outside
      document.addEventListener('click', function(e) {
        if (!donationTooltip.contains(e.target) &&
            !donateIconLink.contains(e.target) &&
            donationTooltipVisible) {
          closeDonationTooltip();
        }
      });

      // Close tooltip on escape key
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && donationTooltipVisible) {
          closeDonationTooltip();
        }
      });
    });
