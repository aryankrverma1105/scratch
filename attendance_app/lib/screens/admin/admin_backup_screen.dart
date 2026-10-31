import 'package:flutter/material.dart';
import '../../core/constants/app_colors.dart';
import '../../core/services/api_service.dart';
import '../../models/salary_models.dart';

class AdminBackupScreen extends StatefulWidget {
  const AdminBackupScreen({super.key});

  @override
  State<AdminBackupScreen> createState() => _AdminBackupScreenState();
}

class _AdminBackupScreenState extends State<AdminBackupScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool _isLoading = true;
  String? _errorMessage;

  List<BackupDestinationModel> _destinations = [];
  List<BackupRecordModel> _records = [];
  bool _isBackingUp = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadData();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final dests = await ApiService().getBackupDestinations();
      final recs = await ApiService().getBackupHistory();
      if (mounted) {
        setState(() {
          _destinations = dests;
          _records = recs;
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

  Future<void> _triggerManualBackup() async {
    setState(() => _isBackingUp = true);
    try {
      final result = await ApiService().triggerManualBackup();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: AppColors.success,
            content: Text('Backup created: ${result['filename']} (${result['destinationsCount']} destination(s))'),
          ),
        );
        _loadData();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: AppColors.error,
            content: Text('Backup failed: ${e.toString().replaceFirst('Exception: ', '')}'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isBackingUp = false);
    }
  }

  Future<void> _testConnection(BackupDestinationModel dest) async {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        backgroundColor: AppColors.info,
        content: Text('Testing connection to ${dest.name}...'),
        duration: const Duration(seconds: 2),
      ),
    );

    try {
      final res = await ApiService().testBackupDestination(dest.id);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: AppColors.success,
            content: Text('Connected: ${res['message'] ?? 'Drive access verified!'}'),
          ),
        );
        _loadData();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: AppColors.error,
            content: Text('Connection failed: ${e.toString().replaceFirst('Exception: ', '')}'),
          ),
        );
        _loadData();
      }
    }
  }

  void _showAddEditDestinationDialog([BackupDestinationModel? existing]) {
    final nameController = TextEditingController(text: existing?.name ?? '');
    final folderController = TextEditingController(text: existing?.folderId ?? '');
    final clientController = TextEditingController();
    final secretController = TextEditingController();
    final refreshController = TextEditingController();
    final emailController = TextEditingController(text: existing?.accountEmail ?? '');
    bool isEnabled = existing?.isEnabled ?? true;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: AppColors.cardDark,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          title: Text(
            existing == null ? 'Add Google Drive Destination' : 'Edit Google Drive Destination',
            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
          ),
          content: SizedBox(
            width: double.maxFinite,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: nameController,
                    style: const TextStyle(color: Colors.white, fontSize: 14),
                    decoration: const InputDecoration(
                      labelText: 'Account / Destination Name *',
                      labelStyle: TextStyle(color: Colors.white70),
                      hintText: 'e.g. Primary Company Drive',
                      hintStyle: TextStyle(color: Colors.white38),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: emailController,
                    style: const TextStyle(color: Colors.white, fontSize: 14),
                    decoration: const InputDecoration(
                      labelText: 'Account Email (Optional)',
                      labelStyle: TextStyle(color: Colors.white70),
                      hintText: 'e.g. backup@sologixenergy.com',
                      hintStyle: TextStyle(color: Colors.white38),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: folderController,
                    style: const TextStyle(color: Colors.white, fontSize: 14),
                    decoration: const InputDecoration(
                      labelText: 'Google Drive Folder ID (Optional)',
                      labelStyle: TextStyle(color: Colors.white70),
                      hintText: 'e.g. 1A2b3C4d... (leave empty for root)',
                      hintStyle: TextStyle(color: Colors.white38),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: clientController,
                    style: const TextStyle(color: Colors.white, fontSize: 14),
                    decoration: InputDecoration(
                      labelText: existing == null ? 'OAuth Client ID *' : 'Update Client ID (optional)',
                      labelStyle: const TextStyle(color: Colors.white70),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: secretController,
                    style: const TextStyle(color: Colors.white, fontSize: 14),
                    obscureText: true,
                    decoration: InputDecoration(
                      labelText: existing == null ? 'OAuth Client Secret *' : 'Update Client Secret (optional)',
                      labelStyle: const TextStyle(color: Colors.white70),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: refreshController,
                    style: const TextStyle(color: Colors.white, fontSize: 14),
                    maxLines: 2,
                    decoration: InputDecoration(
                      labelText: existing == null ? 'OAuth Refresh Token *' : 'Update Refresh Token (optional)',
                      labelStyle: const TextStyle(color: Colors.white70),
                    ),
                  ),
                  const SizedBox(height: 12),
                  SwitchListTile(
                    title: const Text('Enable Automated Daily Backup', style: TextStyle(color: Colors.white, fontSize: 13)),
                    subtitle: const Text('Backs up automatically at 02:00 AM IST', style: TextStyle(color: AppColors.textMuted, fontSize: 11)),
                    value: isEnabled,
                    activeColor: AppColors.info,
                    contentPadding: EdgeInsets.zero,
                    onChanged: (val) => setDialogState(() => isEnabled = val),
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
                if (nameController.text.trim().isEmpty) return;
                Navigator.pop(ctx);
                try {
                  await ApiService().saveBackupDestination(
                    id: existing?.id,
                    name: nameController.text.trim(),
                    folderId: folderController.text.trim().isEmpty ? null : folderController.text.trim(),
                    clientId: clientController.text.trim().isEmpty ? null : clientController.text.trim(),
                    clientSecret: secretController.text.trim().isEmpty ? null : secretController.text.trim(),
                    refreshToken: refreshController.text.trim().isEmpty ? null : refreshController.text.trim(),
                    accountEmail: emailController.text.trim().isEmpty ? null : emailController.text.trim(),
                    isEnabled: isEnabled,
                  );
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(backgroundColor: AppColors.success, content: Text('Backup destination saved successfully')),
                  );
                  _loadData();
                } catch (e) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(backgroundColor: AppColors.error, content: Text(e.toString().replaceFirst('Exception: ', ''))),
                  );
                }
              },
              child: const Text('Save Destination', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        title: const Text('Google Drive Backups', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios, color: Colors.white, size: 20),
          onPressed: () => Navigator.pop(context),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white70),
            onPressed: _loadData,
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(48),
          child: Container(
            margin: const EdgeInsets.symmetric(horizontal: 16),
            decoration: BoxDecoration(
              color: AppColors.cardDark,
              borderRadius: BorderRadius.circular(14),
            ),
            child: TabBar(
              controller: _tabController,
              indicatorColor: AppColors.info,
              labelColor: Colors.white,
              unselectedLabelColor: AppColors.textMuted,
              indicatorSize: TabBarIndicatorSize.tab,
              tabs: const [
                Tab(text: 'Destinations'),
                Tab(text: 'Backup History'),
              ],
            ),
          ),
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: AppColors.info))
          : Column(
              children: [
                // Top Banner with Manual Trigger
                Container(
                  margin: const EdgeInsets.all(16),
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AppColors.cardDark,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: Colors.white12),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Automated Daily Schedule',
                              style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                            ),
                            SizedBox(height: 2),
                            Text(
                              'Runs every night at 02:00 AM IST (Compressed .db.gz snapshot)',
                              style: TextStyle(color: AppColors.textMuted, fontSize: 11.5),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.info,
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                        onPressed: _isBackingUp ? null : _triggerManualBackup,
                        icon: _isBackingUp
                            ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                            : const Icon(Icons.cloud_upload_outlined, size: 18, color: Colors.white),
                        label: const Text('Backup Now', style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold)),
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: TabBarView(
                    controller: _tabController,
                    children: [
                      // Tab 1: Destinations
                      _buildDestinationsTab(),
                      // Tab 2: History
                      _buildHistoryTab(),
                    ],
                  ),
                ),
              ],
            ),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppColors.info,
        icon: const Icon(Icons.add, color: Colors.white),
        label: const Text('Add Account', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        onPressed: () => _showAddEditDestinationDialog(),
      ),
    );
  }

  Widget _buildDestinationsTab() {
    if (_destinations.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off_outlined, color: Colors.white30, size: 48),
              const SizedBox(height: 12),
              const Text(
                'No Google Drive Destinations Configured',
                style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
              ),
              const SizedBox(height: 6),
              const Text(
                'Add one or multiple Google Drive accounts with OAuth credentials to enable automated daily backups.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.textMuted, fontSize: 13),
              ),
              const SizedBox(height: 16),
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(backgroundColor: AppColors.info),
                onPressed: () => _showAddEditDestinationDialog(),
                icon: const Icon(Icons.add, color: Colors.white),
                label: const Text('Add Google Drive Account', style: TextStyle(color: Colors.white)),
              ),
            ],
          ),
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      itemCount: _destinations.length,
      itemBuilder: (context, i) {
        final d = _destinations[i];
        final isConnected = d.lastTestStatus == 'connected';

        return Container(
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.cardDark,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: isConnected ? AppColors.success.withOpacity(0.4) : Colors.white12,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: Colors.amber.withOpacity(0.15),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.add_to_drive, color: Colors.amber, size: 22),
                      ),
                      const SizedBox(width: 12),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(d.name, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15)),
                          if (d.accountEmail != null)
                            Text(d.accountEmail!, style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
                        ],
                      ),
                    ],
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: d.isEnabled ? AppColors.success.withOpacity(0.2) : Colors.white10,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      d.isEnabled ? 'ACTIVE' : 'DISABLED',
                      style: TextStyle(
                        color: d.isEnabled ? AppColors.success : Colors.white54,
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              if (d.folderId != null) ...[
                Text('Folder ID: ${d.folderId}', style: const TextStyle(color: Colors.white54, fontSize: 11.5)),
                const SizedBox(height: 6),
              ],
              Row(
                children: [
                  Icon(
                    isConnected ? Icons.check_circle : Icons.info_outline,
                    size: 14,
                    color: isConnected ? AppColors.success : Colors.amber,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      d.lastTestMessage ?? 'Not tested yet',
                      style: TextStyle(
                        color: isConnected ? AppColors.success : Colors.amber,
                        fontSize: 11.5,
                      ),
                    ),
                  ),
                ],
              ),
              const Divider(color: Colors.white10, height: 24),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.info,
                      side: const BorderSide(color: AppColors.info),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    ),
                    onPressed: () => _testConnection(d),
                    icon: const Icon(Icons.sync, size: 14),
                    label: const Text('Test Connection', style: TextStyle(fontSize: 12)),
                  ),
                  Row(
                    children: [
                      IconButton(
                        icon: const Icon(Icons.edit, color: Colors.white70, size: 18),
                        onPressed: () => _showAddEditDestinationDialog(d),
                      ),
                      IconButton(
                        icon: const Icon(Icons.delete_outline, color: AppColors.error, size: 18),
                        onPressed: () async {
                          final confirm = await showDialog<bool>(
                            context: context,
                            builder: (ctx) => AlertDialog(
                              backgroundColor: AppColors.cardDark,
                              title: const Text('Delete Destination?', style: TextStyle(color: Colors.white)),
                              content: Text('Remove ${d.name}? Automated backups will no longer upload here.', style: const TextStyle(color: Colors.white70)),
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
                            await ApiService().deleteBackupDestination(d.id);
                            _loadData();
                          }
                        },
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildHistoryTab() {
    if (_records.isEmpty) {
      return const Center(
        child: Text('No backup records yet', style: TextStyle(color: AppColors.textMuted)),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      itemCount: _records.length,
      itemBuilder: (context, i) {
        final r = _records[i];
        final isSuccess = r.status == 'success';

        return Container(
          margin: const EdgeInsets.only(bottom: 10),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppColors.cardDark,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: isSuccess ? Colors.white12 : AppColors.error.withOpacity(0.4)),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: (isSuccess ? AppColors.success : AppColors.error).withOpacity(0.15),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  isSuccess ? Icons.cloud_done : Icons.cloud_off,
                  color: isSuccess ? AppColors.success : AppColors.error,
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(
                          child: Text(
                            r.filename,
                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        Text(
                          r.formattedSize,
                          style: const TextStyle(color: AppColors.textMuted, fontSize: 11),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Destination: ${r.destinationName}',
                      style: const TextStyle(color: Colors.white70, fontSize: 12),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${r.backupType == 'manual' ? 'Manual Trigger' : 'Daily Schedule (02:00 AM)'} • ${r.createdAt}',
                      style: const TextStyle(color: AppColors.textMuted, fontSize: 11),
                    ),
                    if (r.errorMessage != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        r.errorMessage!,
                        style: const TextStyle(color: AppColors.error, fontSize: 11),
                      ),
                    ],
                  ],
                ),
              ),
              if (!isSuccess && r.destinationId != null)
                IconButton(
                  icon: const Icon(Icons.replay, color: AppColors.info, size: 20),
                  tooltip: 'Retry upload',
                  onPressed: () async {
                    try {
                      await ApiService().retryBackup(r.id);
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(backgroundColor: AppColors.success, content: Text('Backup upload retried successfully')),
                      );
                      _loadData();
                    } catch (e) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(backgroundColor: AppColors.error, content: Text(e.toString().replaceFirst('Exception: ', ''))),
                      );
                    }
                  },
                ),
            ],
          ),
        );
      },
    );
  }
}
