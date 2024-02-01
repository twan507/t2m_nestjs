import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectModel } from '@nestjs/mongoose';
import { User, UserDocument } from './schemas/user.schemas';
import { IUser } from './users.interface';
import { SoftDeleteModel } from 'soft-delete-plugin-mongoose';
import { compareSync, genSaltSync, hashSync } from 'bcryptjs';
import aqp from 'api-query-params';
import { Role, RoleDocument } from 'src/roles/schemas/role.schemas';

@Injectable()
export class UsersService {

  constructor(
    @InjectModel(User.name)
    private userModel: SoftDeleteModel<UserDocument>,

    @InjectModel(Role.name)
    private roleModel: SoftDeleteModel<RoleDocument>
  ) { }

  getHashPassword = (password: string) => {
    const salt = genSaltSync(10);
    const hash = hashSync(password, salt);
    return hash;
  }

  async create(createUserDto: CreateUserDto, user: IUser) {
    const { email, password, name, phoneNumber, affiliateCode, sponsorCode, role } = createUserDto
    const isExist = await this.userModel.findOne({ email })
    if (isExist) {
      throw new BadRequestException(`Email: ${email} đã tồn tại, vui lòng sử dụng email khác`)
    }
    const hashPassword = this.getHashPassword(password)
    let newUser = await this.userModel.create({
      email,
      password: hashPassword,
      name,
      phoneNumber,
      affiliateCode: affiliateCode ? affiliateCode : "",
      sponsorCode: sponsorCode ? sponsorCode : "",
      role,
      createdBy: {
        _id: user._id,
        email: user.email
      }
    })
    return newUser;
  }

  async register(createUserDto: CreateUserDto) {
    const { email, password, name, phoneNumber, affiliateCode, sponsorCode, role } = createUserDto
    const isExist = await this.userModel.findOne({ email })
    if (isExist) {
      throw new BadRequestException(`Email: ${email} đã tồn tại, vui lòng sử dụng email khác`)
    }
    const userRole = await this.roleModel.findOne({ roleId: "USER" })
    const hashPassword = this.getHashPassword(password)
    let newRegister = await this.userModel.create({
      email,
      password: hashPassword,
      name,
      phoneNumber,
      affiliateCode: affiliateCode ? affiliateCode : "",
      sponsorCode: sponsorCode ? sponsorCode : "",
      role: userRole?._id
    })
    return newRegister
  }

  async findAll(currentPage: number, limit: number, qs: string) {
    const { filter, sort, population } = aqp(qs);
    delete filter.current
    delete filter.pageSize

    let offset = (+currentPage - 1) * (+limit)
    let defaultLimit = +limit ? +limit : 10
    const totalItems = (await this.userModel.find(filter)).length
    const totalPages = Math.ceil(totalItems / defaultLimit)

    const result = await this.userModel.find(filter)
      .skip(offset)
      .limit(defaultLimit)
      .sort(sort as any)
      .populate(population)
      .select("-password")
      .exec()

    return {
      meta: {
        current: currentPage,
        pageSize: limit,
        pages: totalPages,
        total: totalItems
      },
      result
    }
  }

  // const foundRole = await this.roleModel.findById(id)

  async findOne(id: string) {
    const user = await this.userModel
      .findOne({ _id: id })
      .select("-password -tokens") // Loại bỏ password và tokens khỏi kết quả trả về
    .populate({ path: "role", select: { name: 1, _id: 1 } });
    if (!user) {
      throw new BadRequestException("Không tìm thấy User");
    }
    return user;
  }


  async update(id: string, updateUserDto: UpdateUserDto, user: IUser) {
    return await this.userModel.updateOne(
      { _id: id },
      {
        ...updateUserDto,
        updatedBy: {
          _id: user._id,
          email: user.email
        }
      }
    );
  }

  async remove(id: string, user: IUser) {
    // Kiểm tra xem người dùng có tồn tại và không phải là admin
    const foundUser = await this.userModel.findOne({ _id: id });
    // Nếu không tìm thấy người dùng hoặc người dùng là admin
    if (!foundUser) {
      throw new BadRequestException("Không tìm thấy User")
    } else if (foundUser.email === "admin@gmail.com") {
      throw new BadRequestException("Không thể xoá tài khoản Admin")
    }
    // Cập nhật thông tin người xóa
    await this.userModel.updateOne(
      { _id: id },
      {
        deletedBy: {
          _id: user._id,
          email: user.email,
        },
      }
    );
    // Thực hiện soft delete
    return await this.userModel.softDelete({ _id: id });
  }

  updateTokensArray = async (_id: string) => {
    const user = await this.userModel.findOne({ _id: _id });
    const tokensToKeep = user.tokens.slice(-2); // Cắt lấy 2 phần tử cuối cùng
    await this.userModel.updateOne(
      { _id: _id },
      { $set: { tokens: tokensToKeep } }
    );
  }

  refreshTokensArray = async (_id: string, refreshToken: string, newRefreshToken: string) => {
    const user = await this.userModel.findOne({ _id: _id });
    let newTokensList = user.tokens.map(item => item === refreshToken ? newRefreshToken : item);
    await this.userModel.updateOne(
      { _id: _id },
      { $set: { tokens: newTokensList } }
    );
  }

  updateUserToken = async (refreshToken: string, _id: string) => {
    return await this.userModel.updateOne(
      { _id },
      { $push: { tokens: refreshToken } }
    )
  }

  logoutUser = async (_id: string, refreshToken: string) => {
    const user = await this.userModel.findOne({ _id: _id });
    let newTokensList = user.tokens.filter(item => item !== refreshToken);
    return await this.userModel.updateOne(
      { _id: _id },
      { $set: { tokens: newTokensList } }
    );
  }

  isValidPassword(password: string, hash: string) {
    return compareSync(password, hash)
  }

  findOneByUsername(username: string) {
    return this.userModel.findOne({
      email: username
    }).populate({ path: "role", select: { name: 1 } })
  }

  async findUserByToken(refreshToken: string) {
    const user = await this.userModel.findOne({ 'tokens': refreshToken })
      .populate({
        path: "role",
        select: { name: 1 }
      })
    return user;
  }
}