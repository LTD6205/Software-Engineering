import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

// A "merged task": a named parent that several tasks belong to. Members share a
// span (min start → max deadline) but keep their own status and assignees.
@Entity('task_groups')
export class TaskGroup {
  @PrimaryGeneratedColumn('uuid')
  group_id: string;

  @Column()
  event_id: string;

  @Column({ length: 255, default: '' })
  title: string;

  @CreateDateColumn()
  created_at: Date;
}
