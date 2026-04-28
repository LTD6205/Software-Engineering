import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('task_assignments')
export class TaskAssignment {
  @PrimaryGeneratedColumn('uuid')
  assignment_id: string;

  @Column()
  task_id: string;

  @Column()
  user_id: string;

  @CreateDateColumn()
  assigned_at: Date;
}