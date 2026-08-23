import { currentUser } from '@/lib/auth';
import { TrainingQrError } from '@/lib/training-qr';

export async function requireTrainingSelfUser() {
  const user = await currentUser();
  if (!user) {
    throw new TrainingQrError('请先登录个人账号', 401, 'TRAINING_AUTH_REQUIRED');
  }
  if (user.mustChangePassword) {
    throw new TrainingQrError('请先完成首次密码修改', 403, 'TRAINING_PASSWORD_CHANGE_REQUIRED');
  }
  if (!user.employeeId || !user.employee || !user.employee.isActive) {
    throw new TrainingQrError('当前账号没有关联有效员工档案，请联系管理员', 403, 'TRAINING_EMPLOYEE_LINK_REQUIRED');
  }
  return user;
}
