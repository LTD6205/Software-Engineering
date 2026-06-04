import { IsString, IsNotEmpty, IsUUID, MaxLength } from 'class-validator';

// Only the event and the message come from the body — the acting user is the
// JWT subject. (whitelist strips any stray userId a client still sends.)
export class AiCommandDto {
  @IsUUID()
  eventId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string;
}
