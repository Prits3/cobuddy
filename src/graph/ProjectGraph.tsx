import { useEffect, useMemo, useRef } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
} from '@xyflow/react';
import { resolveOwner } from '../components/icons';
import type { Overlap } from '../domain/overlaps';
import { overlapsForTask } from '../domain/overlaps';
import { dependsOnTransitively } from '../domain/tasks';
import type { Project, Task, TaskStatus } from '../domain/types';
import { layoutTasks, NODE_HEIGHT, NODE_WIDTH } from './layout';
import { OverlapEdge, type OverlapFlowEdge } from './OverlapEdge';
import { TaskNode, type TaskFlowNode } from './TaskNode';

const nodeTypes = { task: TaskNode };
const edgeTypes = { overlap: OverlapEdge };

const MINIMAP_COLOR: Record<TaskStatus, string> = {
  queued: '#3c4d63',
  active: '#2fe6ff',
  blocked: '#ff6f61',
  review: '#b9a2ff',
  done: '#3fd08d',
};

interface Props {
  project: Project;
  overlaps: Overlap[];
  selectedId: string | null;
  focus: { id: string; turn: number } | null;
  isMatch: (task: Task) => boolean;
  onSelect: (id: string | null) => void;
}

function overlapState(overlaps: Overlap[], taskId: string): TaskFlowNode['data']['overlap'] {
  const mine = overlapsForTask(overlaps, taskId);
  const open = mine.filter((overlap) => !overlap.accepted);
  if (open.some((overlap) => overlap.severity === 'live')) return 'live';
  if (open.length) return 'possible';
  return mine.length ? 'accepted' : 'none';
}

function Graph({ project, overlaps, selectedId, focus, isMatch, onSelect }: Props) {
  const { fitView, setCenter } = useReactFlow();
  const positions = useMemo(() => layoutTasks(project.tasks), [project.tasks]);

  const positionsRef = useRef(positions);
  positionsRef.current = positions;

  const related = useMemo(() => {
    if (!selectedId) return null;
    const ids = new Set([selectedId]);
    for (const task of project.tasks) {
      if (dependsOnTransitively(project.tasks, selectedId, task.id)) ids.add(task.id);
      if (dependsOnTransitively(project.tasks, task.id, selectedId)) ids.add(task.id);
    }
    for (const overlap of overlapsForTask(overlaps, selectedId)) {
      ids.add(overlap.a.id);
      ids.add(overlap.b.id);
    }
    return ids;
  }, [project.tasks, overlaps, selectedId]);

  const isDimmed = (task: Task) => !isMatch(task) || Boolean(related && !related.has(task.id));

  const nodes = useMemo<TaskFlowNode[]>(
    () =>
      project.tasks.map((task) => ({
        id: task.id,
        type: 'task',
        position: positions.get(task.id)!,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        draggable: false,
        data: {
          task,
          owner: resolveOwner(project, task.owner),
          overlap: overlapState(overlaps, task.id),
          dimmed: isDimmed(task),
          chosen: task.id === selectedId,
        },
      })),
    [project, positions, overlaps, selectedId, related, isMatch],
  );

  const edges = useMemo<(Edge | OverlapFlowEdge)[]>(() => {
    const byId = new Map(project.tasks.map((task) => [task.id, task]));

    const dependencyEdges: Edge[] = project.tasks.flatMap((task) =>
      task.dependsOn.flatMap((dependency) => {
        const source = byId.get(dependency);
        if (!source) return [];
        const onPath = related ? related.has(source.id) && related.has(task.id) : false;
        const dimmed = isDimmed(source) || isDimmed(task);
        const color = dimmed ? '#1d2836' : onPath ? '#2fe6ff' : source.status === 'done' ? '#3f566f' : '#5a7390';
        return [{
          id: `${dependency}->${task.id}`,
          source: dependency,
          target: task.id,
          className: source.status === 'active' && !dimmed ? 'dep-edge flowing' : 'dep-edge',
          style: { stroke: color, strokeWidth: onPath ? 2.25 : 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 15, height: 15 },
        }];
      }),
    );

    const overlapEdges: OverlapFlowEdge[] = overlaps.flatMap((overlap) => {
      const involved = selectedId === overlap.a.id || selectedId === overlap.b.id;
      if (overlap.accepted && !involved) return [];

      const aPos = positions.get(overlap.a.id)!;
      const bPos = positions.get(overlap.b.id)!;
      const aAbove = aPos.y <= bPos.y;
      return [{
        id: `overlap-${overlap.key}`,
        type: 'overlap',
        source: overlap.a.id,
        target: overlap.b.id,
        sourceHandle: aAbove ? 'ov-bottom-s' : 'ov-top-s',
        targetHandle: aAbove ? 'ov-top-t' : 'ov-bottom-t',
        data: {
          live: overlap.severity === 'live',
          dimmed: isDimmed(overlap.a) || isDimmed(overlap.b),
          strong: involved,
        },
      }];
    });

    return [...dependencyEdges, ...overlapEdges];
  }, [project.tasks, positions, overlaps, selectedId, related, isMatch]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void fitView({ padding: 0.1, maxZoom: 1, duration: 250 }));
    return () => cancelAnimationFrame(frame);
  }, [fitView, project.tasks.length, project.tasks.map((task) => task.dependsOn.length).join()]);

  useEffect(() => {
    let timer = 0;
    const refit = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void fitView({ padding: 0.1, maxZoom: 1 }), 150);
    };
    window.addEventListener('resize', refit);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', refit);
    };
  }, [fitView]);

  useEffect(() => {
    const position = focus ? positionsRef.current.get(focus.id) : null;
    if (position) {
      void setCenter(position.x + NODE_WIDTH / 2, position.y + NODE_HEIGHT / 2, { zoom: 0.95, duration: 350 });
    }
  }, [focus, setCenter]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={(_, node) => onSelect(node.id)}
      onPaneClick={() => onSelect(null)}
      nodesDraggable={false}
      nodesConnectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      elementsSelectable={false}
      minZoom={0.2}
      maxZoom={1.6}
      fitView
      fitViewOptions={{ padding: 0.1, maxZoom: 1 }}
    >
      <Background variant={BackgroundVariant.Lines} gap={36} color="#141e2a" />
      <Controls position="bottom-left" showInteractive={false} />
      <MiniMap
        position="bottom-right"
        pannable
        zoomable
        nodeColor={(node) => MINIMAP_COLOR[(node as TaskFlowNode).data.task.status]}
        maskColor="rgba(8, 12, 17, .72)"
      />
    </ReactFlow>
  );
}

export function ProjectGraph(props: Props) {
  return (
    <ReactFlowProvider>
      <Graph {...props} />
    </ReactFlowProvider>
  );
}
