import { EdgeLabelRenderer, Position, type Edge, type EdgeProps } from '@xyflow/react';

export type OverlapFlowEdge = Edge<{ live: boolean; dimmed: boolean; strong: boolean }, 'overlap'>;

const bend = (position: Position) => (position === Position.Bottom ? 56 : -56);

export function OverlapEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<OverlapFlowEdge>) {
  const path = `M ${sourceX} ${sourceY} C ${sourceX} ${sourceY + bend(sourcePosition)}, ${targetX} ${targetY + bend(targetPosition)}, ${targetX} ${targetY}`;
  const classes = ['overlap-edge', data?.live && 'live', data?.dimmed && 'dimmed', data?.strong && 'strong'].filter(Boolean).join(' ');

  return (
    <>
      <path id={id} d={path} className={classes} fill="none" />
      <EdgeLabelRenderer>
        <span
          className={`overlap-label ${classes}`}
          style={{ transform: `translate(-50%, -50%) translate(${(sourceX + targetX) / 2}px, ${(sourceY + targetY) / 2}px)` }}
        >
          {data?.live ? 'Live overlap' : 'Possible overlap'}
        </span>
      </EdgeLabelRenderer>
    </>
  );
}
