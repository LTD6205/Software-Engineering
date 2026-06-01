import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('task_dependencies')
export class TaskDependency {
  @PrimaryGeneratedColumn('uuid')
  dependency_id: string;

  @Column()
  task_id: string;

  @Column()
  depends_on_task: string;
}
