import 'package:flutter/material.dart';
import '../../core/constants/app_colors.dart';
import '../../core/services/api_service.dart';
import '../../models/office_models.dart';

class AdminGeofencingScreen extends StatefulWidget {
  const AdminGeofencingScreen({super.key});

  @override
  State<AdminGeofencingScreen> createState() => _AdminGeofencingScreenState();
}

class _AdminGeofencingScreenState extends State<AdminGeofencingScreen> {
  bool _isLoading = true;
  String? _errorMessage;
  List<OfficeModel> _offices = [];

  @override
  void initState() {
    super.initState();
    _loadOffices();
  }

  Future<void> _loadOffices() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final list = await ApiService().getOffices();
      if (mounted) {
        setState(() {
          _offices = list;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = e.toString().replaceFirst('Exception: ', '');
          _isLoading = false;
        });
      }
    }
  }

  void _showAddEditOfficeDialog([OfficeModel? office]) {
    final isEdit = office != null;
    final nameCtrl = TextEditingController(text: office?.officeName ?? '');
    final addressCtrl = TextEditingController(text: office?.address ?? '');
    final latCtrl = TextEditingController(text: office != null ? office.latitude.toString() : '');
    final lngCtrl = TextEditingController(text: office != null ? office.longitude.toString() : '');
    final descCtrl = TextEditingController(text: office?.description ?? '');
    double radius = office?.radiusMeters ?? 150.0;
    bool isActive = office?.isActive ?? true;

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) {
          return AlertDialog(
            backgroundColor: AppColors.cardDark,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            title: Row(
              children: [
                Icon(
                  isEdit ? Icons.edit_location_alt : Icons.add_location_alt,
                  color: AppColors.info,
                  size: 24,
                ),
                const SizedBox(width: 8),
                Text(
                  isEdit ? 'Edit Office Geofence' : 'Add Office Location',
                  style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.bold),
                ),
              ],
            ),
            content: SizedBox(
              width: MediaQuery.of(context).size.width * 0.9,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    TextField(
                      controller: nameCtrl,
                      style: const TextStyle(color: Colors.white, fontSize: 14),
                      decoration: InputDecoration(
                        labelText: 'Office / Site Name *',
                        labelStyle: const TextStyle(color: AppColors.textMuted),
                        filled: true,
                        fillColor: AppColors.cardDarker,
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: addressCtrl,
                      style: const TextStyle(color: Colors.white, fontSize: 14),
                      decoration: InputDecoration(
                        labelText: 'Full Address',
                        labelStyle: const TextStyle(color: AppColors.textMuted),
                        filled: true,
                        fillColor: AppColors.cardDarker,
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: latCtrl,
                            keyboardType: const TextInputType.numberWithOptions(decimal: true),
                            style: const TextStyle(color: Colors.white, fontSize: 14),
                            decoration: InputDecoration(
                              labelText: 'Latitude *',
                              hintText: '23.3441',
                              labelStyle: const TextStyle(color: AppColors.textMuted),
                              filled: true,
                              fillColor: AppColors.cardDarker,
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: TextField(
                            controller: lngCtrl,
                            keyboardType: const TextInputType.numberWithOptions(decimal: true),
                            style: const TextStyle(color: Colors.white, fontSize: 14),
                            decoration: InputDecoration(
                              labelText: 'Longitude *',
                              hintText: '85.3095',
                              labelStyle: const TextStyle(color: AppColors.textMuted),
                              filled: true,
                              fillColor: AppColors.cardDarker,
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Geofence Radius:', style: TextStyle(color: AppColors.textMuted, fontSize: 13)),
                        Text('${radius.toInt()} metres', style: const TextStyle(color: AppColors.info, fontWeight: FontWeight.bold, fontSize: 14)),
                      ],
                    ),
                    Slider(
                      value: radius,
                      min: 25.0,
                      max: 1000.0,
                      divisions: 39,
                      activeColor: AppColors.info,
                      inactiveColor: Colors.white24,
                      onChanged: (val) {
                        setDialogState(() => radius = val);
                      },
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: descCtrl,
                      maxLines: 2,
                      style: const TextStyle(color: Colors.white, fontSize: 14),
                      decoration: InputDecoration(
                        labelText: 'Description / Project Site Notes',
                        labelStyle: const TextStyle(color: AppColors.textMuted),
                        filled: true,
                        fillColor: AppColors.cardDarker,
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                      ),
                    ),
                    const SizedBox(height: 12),
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: const Text('Active Location', style: TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w600)),
                      subtitle: const Text('Enable geofencing check-in authorization', style: TextStyle(color: AppColors.textMuted, fontSize: 11)),
                      value: isActive,
                      activeColor: AppColors.success,
                      onChanged: (val) => setDialogState(() => isActive = val),
                    ),
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Cancel', style: TextStyle(color: Colors.white70)),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(backgroundColor: AppColors.info),
                onPressed: () async {
                  final name = nameCtrl.text.trim();
                  final lat = double.tryParse(latCtrl.text.trim());
                  final lng = double.tryParse(lngCtrl.text.trim());

                  if (name.isEmpty || lat == null || lng == null) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Please enter valid Name, Latitude and Longitude')),
                    );
                    return;
                  }

                  final payload = {
                    'office_name': name,
                    'address': addressCtrl.text.trim(),
                    'latitude': lat,
                    'longitude': lng,
                    'radius_meters': radius,
                    'description': descCtrl.text.trim(),
                    'status': isActive ? 'active' : 'inactive',
                  };

                  Navigator.pop(ctx);
                  try {
                    if (isEdit) {
                      await ApiService().updateOffice(office.id, payload);
                    } else {
                      await ApiService().createOffice(payload);
                    }
                    _loadOffices();
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(backgroundColor: AppColors.success, content: Text('Office "$name" saved successfully')),
                      );
                    }
                  } catch (e) {
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(backgroundColor: AppColors.error, content: Text('Failed: ${e.toString()}')),
                      );
                    }
                  }
                },
                child: Text(isEdit ? 'Update' : 'Create'),
              ),
            ],
          );
        },
      ),
    );
  }

  Future<void> _deleteOffice(OfficeModel office) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.cardDark,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Delete Office?', style: TextStyle(color: Colors.white)),
        content: Text('Delete or deactivate "${office.officeName}"? Employees will no longer match this geofence.', style: const TextStyle(color: Colors.white70)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.error),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirm == true) {
      try {
        await ApiService().deleteOffice(office.id);
        _loadOffices();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(backgroundColor: AppColors.success, content: Text('Office "${office.officeName}" removed')),
          );
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(backgroundColor: AppColors.error, content: Text('Delete failed: ${e.toString()}')),
          );
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.backgroundDark,
      appBar: AppBar(
        backgroundColor: AppColors.cardDark,
        title: const Text('Geofencing & Offices', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
            onPressed: _loadOffices,
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppColors.info,
        icon: const Icon(Icons.add_location_alt, color: Colors.white),
        label: const Text('Add Office', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        onPressed: () => _showAddEditOfficeDialog(),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _errorMessage != null
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.error_outline, size: 48, color: AppColors.error),
                      const SizedBox(height: 12),
                      Text(_errorMessage!, style: const TextStyle(color: Colors.white70)),
                      const SizedBox(height: 16),
                      ElevatedButton(onPressed: _loadOffices, child: const Text('Retry')),
                    ],
                  ),
                )
              : _offices.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.location_city_outlined, size: 64, color: Colors.white24),
                          const SizedBox(height: 16),
                          const Text('No office locations configured', style: TextStyle(color: Colors.white70, fontSize: 16)),
                          const SizedBox(height: 8),
                          const Text('Tap "Add Office" to set up your first geofence boundary.', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                        ],
                      ),
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: _offices.length,
                      itemBuilder: (ctx, i) {
                        final off = _offices[i];
                        return Card(
                          color: AppColors.cardDark,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                          margin: const EdgeInsets.only(bottom: 14),
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Expanded(
                                      child: Text(
                                        off.officeName,
                                        style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
                                      ),
                                    ),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                      decoration: BoxDecoration(
                                        color: (off.isActive ? AppColors.success : Colors.white24).withOpacity(0.15),
                                        borderRadius: BorderRadius.circular(6),
                                      ),
                                      child: Text(
                                        off.status.toUpperCase(),
                                        style: TextStyle(
                                          color: off.isActive ? AppColors.success : Colors.white60,
                                          fontSize: 10,
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                if (off.address != null && off.address!.isNotEmpty) ...[
                                  const SizedBox(height: 6),
                                  Text(off.address!, style: const TextStyle(color: Colors.white70, fontSize: 13)),
                                ],
                                const SizedBox(height: 10),
                                Wrap(
                                  spacing: 12,
                                  runSpacing: 6,
                                  children: [
                                    _buildMetaChip(Icons.radar, '${off.radiusMeters.toInt()}m radius', AppColors.info),
                                    _buildMetaChip(Icons.pin_drop_outlined, '${off.latitude.toStringAsFixed(4)}, ${off.longitude.toStringAsFixed(4)}', Colors.white60),
                                    if (off.description != null && off.description!.isNotEmpty)
                                      _buildMetaChip(Icons.notes, off.description!, Colors.white60),
                                  ],
                                ),
                                const Divider(color: Colors.white10, height: 24),
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.end,
                                  children: [
                                    OutlinedButton.icon(
                                      style: OutlinedButton.styleFrom(
                                        foregroundColor: AppColors.info,
                                        side: const BorderSide(color: AppColors.info),
                                      ),
                                      onPressed: () => _showAddEditOfficeDialog(off),
                                      icon: const Icon(Icons.edit, size: 16),
                                      label: const Text('Edit'),
                                    ),
                                    const SizedBox(width: 8),
                                    OutlinedButton.icon(
                                      style: OutlinedButton.styleFrom(
                                        foregroundColor: AppColors.error,
                                        side: const BorderSide(color: AppColors.error),
                                      ),
                                      onPressed: () => _deleteOffice(off),
                                      icon: const Icon(Icons.delete_outline, size: 16),
                                      label: const Text('Delete'),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
    );
  }

  Widget _buildMetaChip(IconData icon, String text, Color color) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: color),
        const SizedBox(width: 4),
        Text(text, style: TextStyle(color: color, fontSize: 11.5)),
      ],
    );
  }
}

