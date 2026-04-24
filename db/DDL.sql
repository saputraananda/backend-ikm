-- waschen.mst_employee definition

CREATE TABLE `mst_employee` (
  `employee_id` int NOT NULL,
  `company_id` int DEFAULT NULL,
  `join_year` year DEFAULT NULL,
  `join_seq` int DEFAULT NULL,
  `employee_code` varchar(50) DEFAULT NULL,
  `full_name` varchar(255) DEFAULT NULL,
  `gender` enum('L','P') DEFAULT NULL,
  `birth_place` varchar(255) DEFAULT NULL,
  `birth_date` date DEFAULT NULL,
  `address` text,
  `ktp_number` varchar(50) DEFAULT NULL,
  `ktp_name` varchar(255) DEFAULT NULL,
  `ktp_path` varchar(500) DEFAULT NULL,
  `family_card_number` varchar(50) DEFAULT NULL,
  `phone_number` varchar(50) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `job_level_id` int DEFAULT NULL,
  `position_id` int DEFAULT NULL,
  `department_id` int DEFAULT NULL,
  `join_date` date DEFAULT NULL,
  `supervisor` varchar(50) DEFAULT NULL,
  `employment_status_id` int DEFAULT NULL,
  `contract_end_date` date DEFAULT NULL,
  `education_level_id` int DEFAULT NULL,
  `school_name` varchar(255) DEFAULT NULL,
  `religion_id` int DEFAULT NULL,
  `marital_status` enum('Single','Married','Divorced','Widowed') DEFAULT NULL,
  `bpjs_health_number` varchar(50) DEFAULT NULL,
  `bpjs_employment_number` varchar(50) DEFAULT NULL,
  `npwp_number` varchar(50) DEFAULT NULL,
  `bank_id` int DEFAULT NULL,
  `bank_account_number` varchar(50) DEFAULT NULL,
  `emergency_contact` varchar(255) DEFAULT NULL,
  `is_deleted` tinyint(1) DEFAULT NULL,
  `exit_date` date DEFAULT NULL,
  `exit_reason` text,
  `notes` text,
  `profile_name` varchar(255) DEFAULT NULL,
  `profile_path` varchar(500) DEFAULT NULL,
  `kk_name` varchar(255) DEFAULT NULL,
  `kk_path` varchar(500) DEFAULT NULL,
  `npwp_name` varchar(255) DEFAULT NULL,
  `npwp_path` varchar(500) DEFAULT NULL,
  `bpjs_name` varchar(255) DEFAULT NULL,
  `bpjs_path` varchar(500) DEFAULT NULL,
  `bpjs_tk_name` varchar(255) DEFAULT NULL,
  `bpjs_tk_path` varchar(500) DEFAULT NULL,
  `ijazah_name` varchar(255) DEFAULT NULL,
  `ijazah_path` varchar(500) DEFAULT NULL,
  `sertifikat_name` varchar(255) DEFAULT NULL,
  `sertifikat_path` varchar(500) DEFAULT NULL,
  `rekomkerja_name` varchar(255) DEFAULT NULL,
  `rekomkerja_path` varchar(500) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- waschen.users definition

CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `email` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `username` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `password_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `role` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'admin',
  `avatar` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=118 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- waschen.mst_company definition

CREATE TABLE `mst_company` (
  `company_id` int NOT NULL,
  `company_code` varchar(50) DEFAULT NULL,
  `company_name` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- waschen.mst_religion definition

CREATE TABLE `mst_religion` (
  `religion_id` int NOT NULL,
  `religion_name` varchar(100) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- waschen.mst_bank definition

CREATE TABLE `mst_bank` (
  `bank_id` int NOT NULL,
  `bank_name` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;