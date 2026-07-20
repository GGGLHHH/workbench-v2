import {
  DEFAULT_COMPOSITION_HEIGHT,
  DEFAULT_COMPOSITION_WIDTH,
  createEmptyState,
  createSolidItem,
  createTextItem,
  createTrack,
  type UndoableState,
} from '@gedatou/shared';

export const buildDemoState = (): UndoableState => {
  const state = createEmptyState({
    width: DEFAULT_COMPOSITION_WIDTH,
    height: DEFAULT_COMPOSITION_HEIGHT,
  });
  const textTrack = createTrack('Track 1');
  const bgTrack = createTrack('Track 2');
  state.tracks = [textTrack, bgTrack];
  const bg = createSolidItem({
    trackId: bgTrack.id,
    from: 0,
    width: DEFAULT_COMPOSITION_WIDTH,
    height: DEFAULT_COMPOSITION_HEIGHT,
  });
  bg.durationInFrames = 150;
  bg.color = '#1e293b';
  const title = createTextItem({ trackId: textTrack.id, from: 15, text: 'Hello Remotion' });
  title.top = DEFAULT_COMPOSITION_HEIGHT / 2 - 60;
  title.left = (DEFAULT_COMPOSITION_WIDTH - 600) / 2;
  title.durationInFrames = 120;
  title.fadeInDurationInFrames = 15;
  state.items = { [bg.id]: bg, [title.id]: title };
  return state;
};
