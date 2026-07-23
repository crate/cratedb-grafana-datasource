import { DataFrame, FieldType } from '@grafana/data';

// Explore's logs-volume aggregation classifies per frame: the first number
// field's `level` label picks the severity color for the whole frame. The
// volume query returns one wide frame with a count column per severity, so it
// is split here into one frame per level, the count field labeled with it.
// Severities with no lines in the range are dropped rather than drawn as
// zero-height bars.

export function splitLogVolumeFrames(frames: DataFrame[], refIdPrefix: string): DataFrame[] {
  const result: DataFrame[] = [];
  for (const frame of frames) {
    if (!frame.refId?.startsWith(refIdPrefix)) {
      result.push(frame);
      continue;
    }
    const timeField = frame.fields.find((field) => field.type === FieldType.time);
    const levelFields = frame.fields.filter(
      (field) => field.type === FieldType.number && field.values.some((value) => !!value)
    );
    if (!timeField || levelFields.length === 0) {
      result.push(frame);
      continue;
    }
    for (const levelField of levelFields) {
      result.push({
        refId: frame.refId,
        length: timeField.values.length,
        fields: [
          { name: 'Time', type: FieldType.time, values: timeField.values, config: {} },
          {
            name: 'Value',
            type: FieldType.number,
            values: levelField.values,
            labels: { level: levelField.name },
            config: {},
          },
        ],
      });
    }
  }
  return result;
}
