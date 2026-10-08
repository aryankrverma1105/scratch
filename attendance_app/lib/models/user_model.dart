class UserModel {
  final int id;
  final String email;
  final String? username;
  final String fullName;
  final String role; // 'admin' | 'employee'
  final String? department;
  final String? phone;
  final bool isActive;

  UserModel({
    required this.id,
    required this.email,
    this.username,
    required this.fullName,
    required this.role,
    this.department,
    this.phone,
    this.isActive = true,
  });

  bool get isAdmin => role == 'admin';

  factory UserModel.fromJson(Map<String, dynamic> json) {
    return UserModel(
      id: json['id'] is int ? json['id'] : int.tryParse(json['id'].toString()) ?? 0,
      email: json['email'] ?? '',
      username: json['username'],
      fullName: json['full_name'] ?? 'User',
      role: json['role'] ?? 'employee',
      department: json['department'],
      phone: json['phone'],
      isActive: json['is_active'] == 1 || json['is_active'] == true,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'email': email,
      'username': username,
      'full_name': fullName,
      'role': role,
      'department': department,
      'phone': phone,
      'is_active': isActive ? 1 : 0,
    };
  }
}
