import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

// Wires the previously dormant task_dependencies table. The feature treats a row
// as a symmetric "related" link between two tasks (no dependency ordering / no
// scheduling enforcement); queries check both columns.
@Entity('task_dependencies')
export class TaskDependency {
  @PrimaryGeneratedColumn('uuid')
  dependency_id: string;

  @Column()
  task_id: string;

  @Column()
  depends_on_task: string;
}
