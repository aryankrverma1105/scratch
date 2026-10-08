import 'package:flutter/material.dart';

class AppColors {
  // Backgrounds
  static const Color background = Color(0xFF121212);
  static const Color surfaceDark = Color(0xFF1E1E1E);
  static const Color cardDark = Color(0xFF282828);
  static const Color inputDark = Color(0xFF3F3F3F);
  
  // Gradients
  static const List<Color> mainGradient = [
    Color(0xFF282828),
    Color(0xFF121212),
  ];

  static const List<Color> cardGradient = [
    Color(0xFF575757),
    Color(0xFF3F3F3F),
  ];

  static const List<Color> activeGradient = [
    Color(0xFF2E7D32),
    Color(0xFF1B5E20),
  ];

  // Accents
  static const Color success = Color(0xFF4CAF50);
  static const Color error = Color(0xFFE53935);
  static const Color warning = Color(0xFFFFA000);
  static const Color info = Color(0xFF2196F3);

  // Typography
  static const Color textWhite = Colors.white;
  static const Color textMuted = Color(0xFF8B8B8B);
  static const Color textDim = Colors.white70;
}
