import 'package:flutter/material.dart';
import '../core/constants/app_colors.dart';
import '../models/user_model.dart';

Future<UserModel?> showSearchableEmployeePicker({
  required BuildContext context,
  required List<UserModel> employees,
  UserModel? selected,
  String title = 'Select Employee',
}) async {
  return showModalBottomSheet<UserModel>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (ctx) => _SearchableEmployeePickerSheet(
      employees: employees,
      selected: selected,
      title: title,
    ),
  );
}

class _SearchableEmployeePickerSheet extends StatefulWidget {
  final List<UserModel> employees;
  final UserModel? selected;
  final String title;

  const _SearchableEmployeePickerSheet({
    required this.employees,
    this.selected,
    required this.title,
  });

  @override
  State<_SearchableEmployeePickerSheet> createState() => _SearchableEmployeePickerSheetState();
}

class _SearchableEmployeePickerSheetState extends State<_SearchableEmployeePickerSheet> {
  final TextEditingController _searchController = TextEditingController();
  List<UserModel> _filtered = [];

  @override
  void initState() {
    super.initState();
    _filtered = List.from(widget.employees);
  }

  void _onSearchChanged(String query) {
    final q = query.trim().toLowerCase();
    setState(() {
      if (q.isEmpty) {
        _filtered = List.from(widget.employees);
      } else {
        _filtered = widget.employees.where((e) {
          final nameMatch = e.fullName.toLowerCase().contains(q);
          final emailMatch = e.email.toLowerCase().contains(q);
          final deptMatch = (e.department ?? '').toLowerCase().contains(q);
          final userMatch = (e.username ?? '').toLowerCase().contains(q);
          final phoneMatch = (e.phone ?? '').toLowerCase().contains(q);
          return nameMatch || emailMatch || deptMatch || userMatch || phoneMatch;
        }).toList();
      }
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.8,
      ),
      margin: EdgeInsets.only(bottom: bottomInset),
      decoration: const BoxDecoration(
        color: AppColors.cardDark,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 10),
            Center(
              child: Container(
                width: 44,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.white24,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    widget.title,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 17,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, color: Colors.white70, size: 20),
                    onPressed: () => Navigator.pop(context),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TextField(
                controller: _searchController,
                autofocus: false,
                style: const TextStyle(color: Colors.white, fontSize: 14),
                onChanged: _onSearchChanged,
                decoration: InputDecoration(
                  hintText: 'Search by employee name, email, department...',
                  hintStyle: const TextStyle(color: Colors.white38, fontSize: 13),
                  prefixIcon: const Icon(Icons.search, color: AppColors.info, size: 20),
                  suffixIcon: _searchController.text.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear, color: Colors.white60, size: 18),
                          onPressed: () {
                            _searchController.clear();
                            _onSearchChanged('');
                          },
                        )
                      : null,
                  filled: true,
                  fillColor: Colors.white.withOpacity(0.06),
                  contentPadding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide(color: Colors.white.withOpacity(0.12)),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide(color: Colors.white.withOpacity(0.12)),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: const BorderSide(color: AppColors.info),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: _filtered.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(
                          _searchController.text.trim().isEmpty
                              ? 'No employees available'
                              : 'No employee matching "${_searchController.text}"',
                          style: const TextStyle(color: AppColors.textMuted, fontSize: 13),
                          textAlign: TextAlign.center,
                        ),
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      itemCount: _filtered.length,
                      separatorBuilder: (_, __) => const Divider(color: Colors.white10, height: 1),
                      itemBuilder: (ctx, i) {
                        final emp = _filtered[i];
                        final isSelected = widget.selected?.id == emp.id;

                        return ListTile(
                          contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          leading: CircleAvatar(
                            radius: 20,
                            backgroundColor: isSelected ? AppColors.info : Colors.white12,
                            child: Text(
                              emp.initials,
                              style: TextStyle(
                                color: isSelected ? Colors.white : Colors.white70,
                                fontWeight: FontWeight.bold,
                                fontSize: 13,
                              ),
                            ),
                          ),
                          title: Text(
                            emp.fullName,
                            style: TextStyle(
                              color: isSelected ? AppColors.info : Colors.white,
                              fontWeight: FontWeight.bold,
                              fontSize: 14,
                            ),
                          ),
                          subtitle: Text(
                            [
                              if (emp.department != null && emp.department!.isNotEmpty) emp.department,
                              emp.email,
                            ].join(' • '),
                            style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
                            overflow: TextOverflow.ellipsis,
                          ),
                          trailing: isSelected
                              ? const Icon(Icons.check_circle, color: AppColors.info, size: 20)
                              : null,
                          onTap: () => Navigator.pop(context, emp),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
