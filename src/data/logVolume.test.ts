import { DataFrame, FieldType } from '@grafana/data';

import { splitLogVolumeFrames } from './logVolume';

function wideFrame(refId: string, counts: Record<string, number[]>): DataFrame {
  const times = [1000, 2000, 3000];
  return {
    refId,
    length: times.length,
    fields: [
      { name: 'time', type: FieldType.time, values: times, config: {} },
      ...Object.entries(counts).map(([name, values]) => ({ name, type: FieldType.number, values, config: {} })),
    ],
  };
}

describe('splitLogVolumeFrames', () => {
  it('splits a wide volume frame into one level-labeled frame per severity', () => {
    const frames = splitLogVolumeFrames(
      [wideFrame('log-volume-A', { error: [1, 0, 2], info: [5, 4, 3] })],
      'log-volume-'
    );

    expect(frames).toHaveLength(2);
    for (const frame of frames) {
      expect(frame.refId).toBe('log-volume-A');
      expect(frame.fields[0].type).toBe(FieldType.time);
    }
    expect(frames[0].fields[1].labels).toEqual({ level: 'error' });
    expect(frames[0].fields[1].values).toEqual([1, 0, 2]);
    expect(frames[1].fields[1].labels).toEqual({ level: 'info' });
  });

  it('drops severities with no lines in the range', () => {
    const frames = splitLogVolumeFrames(
      [wideFrame('log-volume-A', { critical: [0, 0, 0], warn: [0, 1, 0] })],
      'log-volume-'
    );

    expect(frames).toHaveLength(1);
    expect(frames[0].fields[1].labels).toEqual({ level: 'warn' });
  });

  it('leaves frames of other queries untouched', () => {
    const plain = wideFrame('A', { value: [1, 2, 3] });

    expect(splitLogVolumeFrames([plain], 'log-volume-')).toEqual([plain]);
  });

  it('passes an empty volume result through unchanged', () => {
    const empty = wideFrame('log-volume-A', { logs: [0, 0, 0] });

    expect(splitLogVolumeFrames([empty], 'log-volume-')).toEqual([empty]);
  });
});
