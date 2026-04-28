import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('milestones')
export class Milestone {
  @PrimaryGeneratedColumn('uuid')
  milestone_id: string;

  @Column()
  task_id: string;

  @Column({ length: 255, nullable: true })
  title: string;

  @Column()
  percentage: number;

  @Column({ type: 'timestamp', nullable: true })
  due_time: Date;

  @Column({ default: false })
  is_completed: boolean;

  @CreateDateColumn()
  created_at: Date;
}