import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  user_id!: string;

  @Column({ length: 100 })
  name!: string;

  @Column({ length: 255, unique: true })
  email!: string;

  @Column({ default: 'staff' })
  role!: string;

  // For staff: the manager they report to, and a pending reassignment awaiting
  // the new manager's approval.
  @Column({ type: 'uuid', nullable: true })
  manager_id!: string | null;

  @Column({ type: 'uuid', nullable: true })
  pending_manager_id!: string | null;

  @Column({ length: 30, nullable: true })
  phone!: string;

  @Column({ type: 'text', nullable: true })
  avatar!: string;

  @Column({ nullable: true })
  password_hash!: string;

  @Column({ default: true })
  is_active!: boolean;

  @CreateDateColumn()
  created_at!: Date;
}
