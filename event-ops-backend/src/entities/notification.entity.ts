import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  notification_id: string;

  @Column()
  user_id: string;

  @Column({ type: 'uuid', nullable: true })
  task_id: string | null;

  // Links a notification to an event (membership / completion alerts). Lets the
  // app clear an event's "completed" notice when the event is reverted.
  @Column({ type: 'uuid', nullable: true })
  event_id: string | null;

  @Column({ length: 20 })
  type: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ default: false })
  is_read: boolean;

  @CreateDateColumn()
  created_at: Date;
}
