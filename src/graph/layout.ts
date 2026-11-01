import dagre from '@dagrejs/dagre';
import type { Task } from '../domain/types';

export const NODE_WIDTH = 228;
export const NODE_HEIGHT = 96;

export function layoutTasks(tasks: Task[]): Map<string, { x: number; y: number }> {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 72, marginx: 10, marginy: 10 });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const task of tasks) graph.setNode(task.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const task of tasks) {
    for (const dependency of task.dependsOn) graph.setEdge(dependency, task.id);
  }

  dagre.layout(graph);

  return new Map(
    tasks.map((task) => {
      const { x, y } = graph.node(task.id);
      return [task.id, { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 }];
    }),
  );
}
