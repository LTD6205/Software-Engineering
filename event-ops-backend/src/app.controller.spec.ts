import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root health', () => {
    it('reports an ok status with the service name', () => {
      const res = appController.health();
      expect(res.status).toBe('ok');
      expect(res.service).toBe('event-ops-backend');
      expect(typeof res.timestamp).toBe('string');
    });
  });
});
