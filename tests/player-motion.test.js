import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/PlayerMotion.js', import.meta.url), 'utf8');

function createHarness(reducedMotion = false) {
  const animations = [];
  const listeners = new Map();
  const classNames = new Set();
  const elements = {
    artwork: {},
    title: {},
    artist: {},
    controls: {},
    icon: {}
  };
  const playButton = {
    dataset: { state: 'play' },
    classList: {
      toggle(name, force) {
        if (force) classNames.add(name);
        else classNames.delete(name);
      },
      contains(name) {
        return classNames.has(name);
      }
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    }
  };
  const document = {
    readyState: 'complete',
    querySelector(selector) {
      return {
        '.editorial-art-frame .art': elements.artwork,
        '.main-player-section .controls': elements.controls,
        '#play-btn .transport-icon': elements.icon
      }[selector] || null;
    },
    getElementById(id) {
      return { title: elements.title, creator: elements.artist, 'play-btn': playButton }[id] || null;
    }
  };
  const context = {
    document,
    elements: { playBtn: playButton },
    matchMedia: () => ({ matches: reducedMotion })
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'js/PlayerMotion.js' });

  for (const element of Object.values(elements)) {
    element.animate = (keyframes, options) => {
      const animation = {
        element,
        keyframes,
        options,
        cancelled: false,
        cancel() {
          this.cancelled = true;
        },
        onfinish: null
      };
      animations.push(animation);
      return animation;
    };
  }

  return { context, elements, playButton, animations, listeners, classNames };
}

{
  const { context, elements, animations } = createHarness();
  context.PlayerMotion.enterTrack();

  assert.equal(animations.length, 4);
  assert.equal(animations[0].element, elements.artwork);
  assert.equal(animations[0].options.duration, 250);
  assert.equal(animations[0].keyframes[0].transform, 'scale(0.95)');
  assert.equal(animations[1].element, elements.title);
  assert.equal(animations[1].options.delay, 50);
  assert.equal(animations[1].keyframes[0].transform, 'translateY(10px)');
  assert.equal(animations[2].element, elements.artist);
  assert.equal(animations[3].element, elements.controls);
  assert.equal(animations[3].options.delay, 100);
  const animatedProperties = animations.flatMap(animation =>
    animation.keyframes.flatMap(frame => Object.keys(frame))
  );
  assert.equal(animatedProperties.every(key => key === 'opacity' || key === 'transform'), true);
}

{
  const { context, playButton, animations, listeners, classNames } = createHarness();
  context.PlayerMotion.syncPlaybackState(true);
  assert.equal(classNames.has('is-playing'), true);

  listeners.get('pointerdown')();
  assert.equal(animations.length, 1);
  assert.equal(animations[0].element, context.document.querySelector('#play-btn .transport-icon'));

  context.PlayerMotion.syncPlaybackState(false);
  assert.equal(classNames.has('is-playing'), false);
  assert.equal(playButton.dataset.state, 'play');
}

{
  const { context, animations, listeners } = createHarness(true);
  context.PlayerMotion.enterTrack();
  listeners.get('pointerdown')();
  assert.equal(animations.length, 0);
}

console.log('Player motion tests passed');
