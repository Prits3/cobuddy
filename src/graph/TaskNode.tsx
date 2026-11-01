import { memo } from 'react';
import { Handle, Position, useStore, type Node, type NodeProps } from '@xyflow/react';
import { OwnerGlyph, StatusIcon, WarningIcon, type ResolvedOwner } from '../components/icons';
import { KIND_LABEL, STATUS_LABEL, type Task } from '../domain/types';

export type TaskNodeData = {
  task: Task;
  owner: ResolvedOwner;
  overlap: 'none' | 'accepted' | 'possible' | 'live';
  dimmed: boolean;
  chosen: boolean;
};

export type TaskFlowNode = Node<TaskNodeData, 'task'>;

const hidden = { opacity: 0, pointerEvents: 'none' as const };

const OVERLAP_LABEL = { live: 'Live overlap', possible: 'Possible overlap', accepted: 'Overlap accepted', none: '' };

function TaskNodeView({ data }: NodeProps<TaskFlowNode>) {
  const compact = useStore((state) => state.transform[2] < 0.72);
  const { task, owner, overlap, dimmed, chosen } = data;

  const classes = ['task-node', `status-${task.status}`, compact && 'compact', dimmed && 'dimmed', chosen && 'chosen', overlap !== 'none' && `overlap-${overlap}`]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <Handle type="target" position={Position.Left} style={hidden} isConnectable={false} />
      <Handle type="source" position={Position.Right} style={hidden} isConnectable={false} />
      <Handle id="ov-top-s" type="source" position={Position.Top} style={hidden} isConnectable={false} />
      <Handle id="ov-top-t" type="target" position={Position.Top} style={hidden} isConnectable={false} />
      <Handle id="ov-bottom-s" type="source" position={Position.Bottom} style={hidden} isConnectable={false} />
      <Handle id="ov-bottom-t" type="target" position={Position.Bottom} style={hidden} isConnectable={false} />

      <button
        type="button"
        className={classes}
        aria-label={`${task.ref} ${task.title}. ${STATUS_LABEL[task.status]}. Owner: ${owner.name}. ${OVERLAP_LABEL[overlap]}`}
      >
        <span className="node-top">
          {compact && <OwnerGlyph owner={owner} />}
          <span className="node-ref">{task.ref}{!compact && <i> / {KIND_LABEL[task.kind]}</i>}</span>
          {overlap !== 'none' && (
            <span className="node-overlap" title={OVERLAP_LABEL[overlap]}><WarningIcon size={compact ? 20 : 13} /></span>
          )}
          <span className="node-status"><StatusIcon status={task.status} size={compact ? 20 : 13} />{!compact && STATUS_LABEL[task.status]}</span>
        </span>
        <span className="node-title">{task.title}</span>
        {!compact && (
          <span className="node-owner">
            <OwnerGlyph owner={owner} />
            <span>{owner.name}</span>
          </span>
        )}
      </button>
    </>
  );
}

export const TaskNode = memo(TaskNodeView);
