/**
 * player-bottom-sheet.js — Shared Bottom Sheet Controller
 *
 * Powers both the global app menu and the contextual track menu.
 * Supports overlay dismiss, Escape, focus trapping, and swipe-to-dismiss.
 */

(function () {
  'use strict';

  var SWIPE_DISMISS_THRESHOLD = 80;

  var overlay = null;
  var controllers = [];
  var activeController = null;

  function getFocusableElements(sheet) {
    return Array.prototype.slice.call(
      sheet.querySelectorAll('button, [tabindex="0"], [tabindex]:not([tabindex="-1"])')
    ).filter(function (el) {
      return !el.disabled && el.offsetParent !== null;
    });
  }

  function focusElement(element) {
    if (!element || typeof element.focus !== 'function') return false;
    try {
      element.focus({ preventScroll: true });
      return true;
    } catch (e) {
      try {
        element.focus();
        return true;
      } catch (focusError) {
        return false;
      }
    }
  }

  function setOverlayState(isOpen) {
    if (!overlay) return;
    overlay.classList.toggle('open', isOpen);
    overlay.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    document.body.classList.toggle('sheet-open', isOpen);
  }

  function setSheetInteractivity(sheet, isOpen) {
    if (!sheet) return;
    sheet.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    try {
      sheet.inert = !isOpen;
    } catch (e) {
      if (isOpen) {
        sheet.removeAttribute('inert');
      } else {
        sheet.setAttribute('inert', '');
      }
    }
  }

  function moveFocusOutsideSheet(controller) {
    if (!controller || !controller.sheet) return;

    var activeElement = document.activeElement;
    if (!activeElement || !controller.sheet.contains(activeElement)) return;

    if (controller.trigger && !controller.sheet.contains(controller.trigger) && focusElement(controller.trigger)) {
      return;
    }

    try {
      activeElement.blur();
    } catch (e) {}
  }

  function closeSheet(controller, options) {
    var shouldRestoreFocus = !options || options.restoreFocus !== false;
    if (!controller || !controller.sheet) return;

    moveFocusOutsideSheet(controller);
    controller.sheet.classList.remove('open');
    setSheetInteractivity(controller.sheet, false);
    controller.sheet.style.transform = '';

    if (controller.trigger) {
      controller.trigger.setAttribute('aria-expanded', 'false');
      if (shouldRestoreFocus) {
        focusElement(controller.trigger);
      }
    }

    controller.touch.startY = 0;
    controller.touch.currentY = 0;
    controller.touch.isDragging = false;

    if (activeController === controller) {
      activeController = null;
      setOverlayState(false);
    }
  }

  function openSheet(controller) {
    if (!controller || !controller.sheet || !overlay) return;

    if (activeController && activeController !== controller) {
      closeSheet(activeController, { restoreFocus: false });
    }

    activeController = controller;
    controller.sheet.classList.add('open');
    setSheetInteractivity(controller.sheet, true);
    controller.trigger.setAttribute('aria-expanded', 'true');
    setOverlayState(true);

    var firstFocusable = getFocusableElements(controller.sheet)[0];
    if (firstFocusable) {
      setTimeout(function () {
        if (activeController === controller) {
          firstFocusable.focus();
        }
      }, 50);
    }
  }

  function toggleSheet(controller) {
    if (!controller) return;
    if (activeController === controller) {
      closeSheet(controller);
      return;
    }
    openSheet(controller);
  }

  function handleTriggerKeydown(controller, event) {
    if (!controller || !event) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleSheet(controller);
  }

  function handleTouchStart(controller, event) {
    if (!controller || activeController !== controller || event.touches.length !== 1) return;
    controller.touch.startY = event.touches[0].clientY;
    controller.touch.currentY = controller.touch.startY;
    controller.touch.isDragging = false;
  }

  function handleTouchMove(controller, event) {
    if (!controller || activeController !== controller || event.touches.length !== 1) return;

    controller.touch.currentY = event.touches[0].clientY;
    var delta = controller.touch.currentY - controller.touch.startY;
    if (delta <= 0) return;

    controller.touch.isDragging = true;
    controller.sheet.style.transform = 'translateY(' + delta + 'px)';
    event.preventDefault();
  }

  function handleTouchEnd(controller) {
    if (!controller || activeController !== controller) return;

    var delta = controller.touch.currentY - controller.touch.startY;
    if (controller.touch.isDragging && delta > SWIPE_DISMISS_THRESHOLD) {
      closeSheet(controller);
    } else {
      controller.sheet.style.transform = '';
    }

    controller.touch.isDragging = false;
  }

  function handleDocumentKeydown(event) {
    if (!activeController || !activeController.sheet) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeSheet(activeController);
      return;
    }

    if (event.key !== 'Tab') return;

    var focusable = getFocusableElements(activeController.sheet);
    if (focusable.length === 0) return;

    var first = focusable[0];
    var last = focusable[focusable.length - 1];

    if (event.shiftKey) {
      if (document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      return;
    }

    if (document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function wireAutoCloseActions(controller) {
    Array.prototype.forEach.call(
      controller.sheet.querySelectorAll('[data-close-sheet-on-activate="true"]'),
      function (element) {
        var scheduleClose = function () {
          setTimeout(function () {
            if (activeController === controller) {
              closeSheet(controller, { restoreFocus: false });
            }
          }, 0);
        };

        element.addEventListener('click', scheduleClose);

        if (element.tagName !== 'BUTTON') {
          element.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' || event.key === ' ') {
              scheduleClose();
            }
          });
        }
      }
    );
  }

  function createController(trigger) {
    var sheetId = trigger.getAttribute('data-sheet-target') || trigger.getAttribute('aria-controls');
    var sheet = sheetId ? document.getElementById(sheetId) : null;
    if (!sheet) return null;

    var controller = {
      trigger: trigger,
      sheet: sheet,
      touch: { startY: 0, currentY: 0, isDragging: false }
    };

    setSheetInteractivity(sheet, false);

    trigger.addEventListener('click', function (event) {
      event.preventDefault();
      toggleSheet(controller);
    });

    if (trigger.tagName !== 'BUTTON') {
      trigger.addEventListener('keydown', function (event) {
        handleTriggerKeydown(controller, event);
      });
    }

    sheet.addEventListener('touchstart', function (event) {
      handleTouchStart(controller, event);
    }, { passive: true });

    sheet.addEventListener('touchmove', function (event) {
      handleTouchMove(controller, event);
    }, { passive: false });

    sheet.addEventListener('touchend', function () {
      handleTouchEnd(controller);
    }, { passive: true });

    Array.prototype.forEach.call(sheet.querySelectorAll('.sheet-cancel-btn'), function (button) {
      button.addEventListener('click', function () {
        closeSheet(controller);
      });
    });

    wireAutoCloseActions(controller);

    return controller;
  }

  function init() {
    overlay = document.getElementById('bottom-sheet-overlay');
    if (!overlay) return;

    controllers = Array.prototype.map.call(
      document.querySelectorAll('[data-sheet-target]'),
      createController
    ).filter(Boolean);

    if (controllers.length === 0) return;

    overlay.addEventListener('click', function () {
      if (activeController) {
        closeSheet(activeController);
      }
    });

    document.addEventListener('keydown', handleDocumentKeydown);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
