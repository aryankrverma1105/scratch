import 'package:flutter/material.dart';
import '../core/constants/app_colors.dart';
import '../core/services/api_service.dart';

class AuthenticatedSelfieView extends StatelessWidget {
  final String? filename;
  final double width;
  final double height;
  final BorderRadius? borderRadius;
  final BoxFit fit;

  const AuthenticatedSelfieView({
    super.key,
    required this.filename,
    this.width = 60,
    this.height = 60,
    this.borderRadius,
    this.fit = BoxFit.cover,
  });

  @override
  Widget build(BuildContext context) {
    if (filename == null || filename!.isEmpty) {
      return Container(
        width: width,
        height: height,
        decoration: BoxDecoration(
          color: AppColors.surfaceDark,
          borderRadius: borderRadius ?? BorderRadius.circular(12),
        ),
        child: const Icon(Icons.person, color: AppColors.textMuted),
      );
    }

    final url = ApiService().getSelfieUrl(filename);
    final headers = ApiService().authHeaders;

    return ClipRRect(
      borderRadius: borderRadius ?? BorderRadius.circular(12),
      child: Image.network(
        url,
        headers: headers,
        width: width,
        height: height,
        fit: fit,
        loadingBuilder: (context, child, loadingProgress) {
          if (loadingProgress == null) return child;
          return Container(
            width: width,
            height: height,
            color: AppColors.surfaceDark,
            child: const Center(
              child: SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white60),
              ),
            ),
          );
        },
        errorBuilder: (context, error, stackTrace) {
          return Container(
            width: width,
            height: height,
            color: AppColors.surfaceDark,
            child: const Icon(Icons.broken_image, color: AppColors.textMuted, size: 20),
          );
        },
      ),
    );
  }

  static void showFullSelfieDialog(BuildContext context, String? filename, String title) {
    if (filename == null || filename.isEmpty) return;
    showDialog(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: AppColors.cardDark,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(title, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
                  IconButton(
                    icon: const Icon(Icons.close, color: AppColors.textMuted),
                    onPressed: () => Navigator.pop(ctx),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              AuthenticatedSelfieView(
                filename: filename,
                width: 280,
                height: 280,
                fit: BoxFit.contain,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
